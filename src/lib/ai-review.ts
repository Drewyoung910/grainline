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
  imageUrls?: string[]
}): Promise<AIReviewResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { approved: true, flags: [], confidence: 1, reason: 'AI review disabled — no API key' }
  }

  const prompt = `You are a marketplace moderator for Grainline, a handmade woodworking marketplace in the US.

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

IMAGE REVIEW:
When images are provided, examine them for violations that text alone cannot reveal:
- Explicit or sexual content visible in images
- Copyrighted characters (Disney, Marvel, sports logos) visible on products
- Counterfeit brand logos (Rolex, Louis Vuitton, Gucci) on items
- Hate symbols or extremist imagery
- Weapons (firearms, knives as weapons) vs tools
- Drug paraphernalia (bongs, pipes, rolling trays) vs decorative items
- Items clearly mass-produced (identical stock photos, Alibaba-style imagery)
- Product image does not match the title/description (bait-and-switch)

If images look stock/generic or show mass-produced goods, flag as "possibly-not-handmade".
If image quality is poor but item seems legitimate, approve — new sellers may lack photography skills.

LENIENCY FOR NEW SELLERS:
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
    const messageContent: Array<{
      type: 'text' | 'image_url'
      text?: string
      image_url?: { url: string; detail: 'low' | 'high' | 'auto' }
    }> = [{ type: 'text', text: prompt }]

    if (listing.imageUrls && listing.imageUrls.length > 0) {
      const imagesToReview = listing.imageUrls.slice(0, 4)
      for (const url of imagesToReview) {
        messageContent.push({
          type: 'image_url',
          image_url: { url, detail: 'low' }
        })
      }
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: messageContent }],
        max_tokens: 300,
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
