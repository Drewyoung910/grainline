// Minimal dependency-free psql script interpreter for the database adapters.
//
// Supports exactly the psql features used by the Grainline role scripts:
//   \set NAME VALUE, \unset NAME, \echo ARGS, \if / \elif / \else / \endif,
//   \gset [PREFIX], \gexec, and variable interpolation :name, :'name',
//   :"name", :{?name} outside quotes/comments. ON_ERROR_STOP semantics are
//   always on: the first SQL error rolls back an open transaction and throws.
//
// Statements are sent one by one with the adapter's query method,
// like psql does. A statement ends at a top-level semicolon (outside quotes,
// dollar quotes, comments and parentheses). \gset/\gexec with an empty query
// buffer re-execute the most recently sent query, which is psql behaviour.

function quoteLiteral(v) {
  const s = String(v);
  if (s.includes('\\')) return "E'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
  return "'" + s.replace(/'/g, "''") + "'";
}
function quoteIdent(v) {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

function parseBool(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) throw new Error(`psql: unrecognized boolean ''`);
  const pref = (word) => word.startsWith(v);
  if (pref('true') || pref('yes') || v === '1') return true;
  if (pref('false') || pref('no') || v === '0') return false;
  if (v.length >= 2 && pref('on')) return true;
  if (v.length >= 2 && pref('off')) return false;
  throw new Error(`psql: unrecognized value "${raw}" for boolean`);
}

// Substitute :var forms in a meta-command argument string and split args.
function parseMetaArgs(argStr, vars) {
  const args = [];
  let i = 0;
  const n = argStr.length;
  while (i < n) {
    while (i < n && /\s/.test(argStr[i])) i++;
    if (i >= n) break;
    let tok = '';
    if (argStr[i] === "'") {
      i++;
      while (i < n) {
        if (argStr[i] === "'") {
          if (argStr[i + 1] === "'") { tok += "'"; i += 2; continue; }
          i++; break;
        }
        tok += argStr[i++];
      }
      args.push(tok);
      continue;
    }
    if (argStr[i] === ':') {
      const rest = argStr.slice(i);
      let m;
      if ((m = rest.match(/^:\{\?([A-Za-z0-9_]+)\}/))) {
        args.push(Object.prototype.hasOwnProperty.call(vars, m[1]) ? 'TRUE' : 'FALSE');
        i += m[0].length; continue;
      }
      if ((m = rest.match(/^:'([A-Za-z0-9_]+)'/))) {
        args.push(quoteLiteral(vars[m[1]] ?? '')); i += m[0].length; continue;
      }
      if ((m = rest.match(/^:"([A-Za-z0-9_]+)"/))) {
        args.push(quoteIdent(vars[m[1]] ?? '')); i += m[0].length; continue;
      }
      if ((m = rest.match(/^:([A-Za-z0-9_]+)/))) {
        if (Object.prototype.hasOwnProperty.call(vars, m[1])) {
          args.push(String(vars[m[1]]));
        } else {
          args.push(m[0]);
        }
        i += m[0].length; continue;
      }
    }
    while (i < n && !/\s/.test(argStr[i])) tok += argStr[i++];
    args.push(tok);
  }
  return args;
}

export async function runPsqlScript(db, scriptText, initialVars = {}, opts = {}) {
  const log = opts.log ?? (() => {});
  const vars = { ...initialVars };
  const ifStack = []; // {active, taken, parentActive}
  const isActive = () => ifStack.every((f) => f.active);
  let buf = '';
  let lastQuery = null;
  let stmtCount = 0;
  const echoes = [];

  const execSql = async (sql) => {
    stmtCount++;
    try {
      const result = await db.query(sql);
      return Array.isArray(result) ? result : [result];
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch {}
      const err = new Error(`psql statement failed: ${e.message}`);
      err.code = e.code;
      err.sql = sql;
      err.cause = e;
      throw err;
    }
  };
  const lastRows = (res) => {
    const r = res[res.length - 1];
    return { rows: r?.rows ?? [], fields: r?.fields ?? [] };
  };

  const flushStatement = async () => {
    const sql = buf;
    buf = '';
    if (!sql.trim()) return;
    if (!isActive()) return;
    lastQuery = sql;
    await execSql(sql);
  };

  const takeQueryForG = () => {
    if (buf.trim()) { const q = buf; buf = ''; lastQuery = q; return q; }
    buf = '';
    if (!lastQuery) throw new Error('psql: \\g* with no previous query');
    return lastQuery;
  };

  const handleMeta = async (cmd, argStr) => {
    // Conditionals are processed even in inactive branches.
    if (cmd === 'if') {
      const parentActive = isActive();
      if (!parentActive) { ifStack.push({ active: false, taken: true }); return; }
      const args = parseMetaArgs(argStr, vars);
      const val = parseBool(args.join(' '));
      ifStack.push({ active: val, taken: val });
      return;
    }
    if (cmd === 'elif') {
      const top = ifStack[ifStack.length - 1];
      if (!top) throw new Error('psql: \\elif without \\if');
      const parentActive = ifStack.slice(0, -1).every((f) => f.active);
      if (!parentActive || top.taken) { top.active = false; return; }
      const val = parseBool(parseMetaArgs(argStr, vars).join(' '));
      top.active = val; top.taken = val;
      return;
    }
    if (cmd === 'else') {
      const top = ifStack[ifStack.length - 1];
      if (!top) throw new Error('psql: \\else without \\if');
      const parentActive = ifStack.slice(0, -1).every((f) => f.active);
      top.active = parentActive && !top.taken;
      top.taken = true;
      return;
    }
    if (cmd === 'endif') {
      if (!ifStack.length) throw new Error('psql: \\endif without \\if');
      ifStack.pop();
      buf = buf; // psql keeps query buffer across conditionals
      return;
    }
    if (!isActive()) {
      if (cmd === 'gset' || cmd === 'gexec' || cmd === 'g') buf = '';
      return;
    }
    switch (cmd) {
      case 'set': {
        const args = parseMetaArgs(argStr, vars);
        if (!args.length) return;
        vars[args[0]] = args.slice(1).join('');
        return;
      }
      case 'unset': {
        const args = parseMetaArgs(argStr, vars);
        for (const a of args) delete vars[a];
        return;
      }
      case 'echo': {
        const line = parseMetaArgs(argStr, vars).join(' ');
        echoes.push(line);
        log(`[psql echo] ${line}`);
        return;
      }
      case 'gset': {
        const prefix = parseMetaArgs(argStr, vars)[0] ?? '';
        const q = takeQueryForG();
        const { rows, fields } = lastRows(await execSql(q));
        if (rows.length !== 1) throw new Error(`psql: \\gset expected 1 row, got ${rows.length}`);
        for (const f of fields) {
          const v = rows[0][f.name];
          const name = prefix + f.name;
          if (v === null || v === undefined) delete vars[name];
          else vars[name] = typeof v === 'boolean' ? (v ? 't' : 'f') : String(v);
        }
        return;
      }
      case 'gexec': {
        const q = takeQueryForG();
        const { rows, fields } = lastRows(await execSql(q));
        for (const row of rows) {
          for (const f of fields) {
            const v = row[f.name];
            if (v === null || v === undefined) continue;
            await execSql(String(v));
          }
        }
        return;
      }
      case 'g': {
        const q = takeQueryForG();
        await execSql(q);
        return;
      }
      case 'q': case 'quit':
        throw Object.assign(new Error('psql quit'), { quit: true });
      default:
        throw new Error(`psql: unsupported meta-command \\${cmd}`);
    }
  };

  const s = scriptText;
  const n = s.length;
  let i = 0;
  let paren = 0;
  try {
    while (i < n) {
      const c = s[i];
      const c2 = s[i + 1];
      // line comment
      if (c === '-' && c2 === '-') {
        const j = s.indexOf('\n', i);
        const end = j === -1 ? n : j;
        buf += s.slice(i, end);
        i = end;
        continue;
      }
      // block comment (nested)
      if (c === '/' && c2 === '*') {
        let depth = 1; let j = i + 2;
        while (j < n && depth > 0) {
          if (s[j] === '/' && s[j + 1] === '*') { depth++; j += 2; continue; }
          if (s[j] === '*' && s[j + 1] === '/') { depth--; j += 2; continue; }
          j++;
        }
        buf += s.slice(i, j); i = j; continue;
      }
      // E'' string
      if ((c === 'E' || c === 'e') && c2 === "'" && !/[A-Za-z0-9_$]/.test(s[i - 1] ?? '')) {
        let j = i + 2;
        while (j < n) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } j++; break; }
          j++;
        }
        buf += s.slice(i, j); i = j; continue;
      }
      if (c === "'") {
        let j = i + 1;
        while (j < n) {
          if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } j++; break; }
          j++;
        }
        buf += s.slice(i, j); i = j; continue;
      }
      if (c === '"') {
        let j = i + 1;
        while (j < n) {
          if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } j++; break; }
          j++;
        }
        buf += s.slice(i, j); i = j; continue;
      }
      if (c === '$' && !/[A-Za-z0-9_]/.test(s[i - 1] ?? '')) {
        const m = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
        if (m) {
          const tag = m[0];
          const close = s.indexOf(tag, i + tag.length);
          if (close === -1) throw new Error(`psql: unterminated dollar quote ${tag}`);
          buf += s.slice(i, close + tag.length);
          i = close + tag.length; continue;
        }
      }
      if (c === '\\') {
        // meta-command until end of line
        const j = s.indexOf('\n', i);
        const end = j === -1 ? n : j;
        const line = s.slice(i + 1, end);
        const m = line.match(/^([A-Za-z?]+)\s*(.*)$/);
        if (!m) throw new Error(`psql: bad meta-command line \\${line}`);
        i = end;
        await handleMeta(m[1], m[2]);
        continue;
      }
      if (c === ':' ) {
        if (c2 === ':') { buf += '::'; i += 2; continue; }
        const rest = s.slice(i, i + 200);
        let m;
        if ((m = rest.match(/^:\{\?([A-Za-z0-9_]+)\}/))) {
          buf += Object.prototype.hasOwnProperty.call(vars, m[1]) ? 'TRUE' : 'FALSE';
          i += m[0].length; continue;
        }
        if ((m = rest.match(/^:'([A-Za-z0-9_]+)'/)) && Object.prototype.hasOwnProperty.call(vars, m[1])) {
          buf += quoteLiteral(vars[m[1]]); i += m[0].length; continue;
        }
        if ((m = rest.match(/^:"([A-Za-z0-9_]+)"/)) && Object.prototype.hasOwnProperty.call(vars, m[1])) {
          buf += quoteIdent(vars[m[1]]); i += m[0].length; continue;
        }
        if ((m = rest.match(/^:([A-Za-z0-9_]+)/)) && Object.prototype.hasOwnProperty.call(vars, m[1])) {
          buf += String(vars[m[1]]); i += m[0].length; continue;
        }
        buf += c; i++; continue;
      }
      if (c === '(') paren++;
      if (c === ')') paren = Math.max(0, paren - 1);
      if (c === ';' && paren === 0) {
        buf += ';';
        i++;
        await flushStatement();
        continue;
      }
      buf += c;
      i++;
    }
    if (buf.trim() && !/^\s*(--[^\n]*\n?\s*)*$/.test(buf)) {
      // psql sends a trailing unterminated statement at EOF
      await flushStatement();
    }
  } catch (e) {
    if (e.quit) return { vars, echoes, stmtCount };
    e.echoes = echoes;
    throw e;
  }
  if (ifStack.length) throw new Error('psql: unterminated \\if');
  return { vars, echoes, stmtCount };
}
