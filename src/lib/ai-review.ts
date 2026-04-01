interface AIReviewResult {
  approved: boolean
  flags: string[]
  confidence: number
  reason: string
}

export async function reviewListingWithAI(listing: {
  title: string
  description: string | null
  priceCents: number
  category: string | null
  tags: string[]
  sellerName: string
  listingCount: number
}): Promise<AIReviewResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { approved: true, flags: [], confidence: 1, reason: 'AI review disabled — no API key' }
  }

  const prompt = `You are a marketplace moderator for Grainline, a handmade woodworking marketplace in the US and Canada.

Review this listing and determine if it should be approved for publication.

Listing details:
Title: ${listing.title}
Description: ${listing.description || 'None provided'}
Price: $${(listing.priceCents / 100).toFixed(2)}
Category: ${listing.category || 'Uncategorized'}
Tags: ${listing.tags.join(', ') || 'None'}
Seller: ${listing.sellerName}
Seller total listings: ${listing.listingCount}

Flag and reject ONLY if:
- Clearly not woodworking or handmade related
- Prohibited items (weapons, illegal goods, digital-only products, obviously mass-produced)
- Price under $1 or over $50,000 with no reasonable context
- Obvious spam (gibberish, repeated characters, meaningless text)
- Inappropriate or offensive content
- Obvious test listing (title is literally "test", "asdf", "aaa" etc)

Be lenient — woodworking covers furniture, cutting boards, art, home decor, toys, tools, and more.
New sellers (low listing count) should get benefit of the doubt unless clearly problematic.

Respond with ONLY valid JSON, no other text:
{
  "approved": true or false,
  "flags": ["specific issues found, empty array if none"],
  "confidence": 0.0 to 1.0,
  "reason": "one sentence explanation"
}`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean) as AIReviewResult
  } catch {
    return {
      approved: true,
      flags: ['AI review unavailable — manual spot check recommended'],
      confidence: 0.5,
      reason: 'AI review error — defaulting to approve'
    }
  }
}
