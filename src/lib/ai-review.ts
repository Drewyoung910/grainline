import { prisma } from '@/lib/db'

interface AIReviewResult {
  approved: boolean
  flags: string[]
  confidence: number
  reason: string
}

export async function reviewListingWithAI(listing: {
  sellerId: string
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

  // Duplicate detection — catch spammers posting same listing repeatedly
  try {
    const duplicateCount = await prisma.listing.count({
      where: {
        sellerId: listing.sellerId,
        title: { equals: listing.title, mode: 'insensitive' },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    })

    if (duplicateCount >= 2) {
      return {
        approved: false,
        flags: ['duplicate-listing', 'possible-spam'],
        confidence: 0.95,
        reason: 'Seller has already posted 2+ listings with this exact title in the last 24 hours'
      }
    }
  } catch (error) {
    console.error('Duplicate check failed:', error instanceof Error ? error.message : error)
    // Non-fatal — continue to AI review
  }

  const prompt = `You are a content moderator for Grainline, a handmade woodworking marketplace serving the US and Canada.

Review this listing and determine if it should be approved for publication.

LISTING DETAILS:
Title: ${listing.title}
Description: ${listing.description || 'None provided'}
Price: $${(listing.priceCents / 100).toFixed(2)}
Category: ${listing.category || 'Uncategorized'}
Tags: ${listing.tags.join(', ') || 'None'}
Seller: ${listing.sellerName}
Seller total listings: ${listing.listingCount}

APPROVE if the listing is:
- Handmade woodworking or wood-focused craft (furniture, cutting boards, decor, toys, tools, art, turned bowls, etc.)
- Mixed-material items where wood is a primary component (resin-and-wood charcuterie, metal-and-wood furniture, etc.)
- Clearly handmade by the seller (not dropshipped, not mass-produced)
- Priced reasonably ($1-$50,000 depending on item complexity)

REJECT if the listing contains ANY of:

1. Counterfeit or replica branded goods (fake Rolex, knockoff Louis Vuitton, "Gucci inspired", etc.)
2. Unlicensed copyrighted characters (Disney, Marvel, Harry Potter, Pokemon, sports team logos)
3. Regulated goods (firearms, ammunition, tobacco, vapes, alcohol, cannabis/CBD, prescription drugs, lottery)
4. Weapons marketed as weapons (brass knuckles, concealed weapons) — tools like kitchen/hunting knives OK
5. Adult or sexually explicit content or suggestive imagery
6. Hate symbols or extremist content (Nazi imagery, racist imagery, terrorist imagery)
7. Protected species materials (ivory, protected fur, tortoiseshell, protected coral)
8. Medical claims or unregulated health products (healing crystals as cure, CBD as medicine, supplements)
9. Services disguised as goods (escort, companion, lessons disguised as products)
10. Digital-only products (PDFs, downloads, e-books — unless bundled with physical item)
11. Mass-produced or dropshipped items (Alibaba, Temu, Shein imagery/patterns)
12. Scams or spam (gibberish, price wildly mismatched, all-caps, test listings like "asdf", "test")
13. Non-woodworking primary goods (pure pottery, pure leather, pure metal with no wood element)

IMAGE REVIEW:
When images are provided, examine them for violations that text alone cannot reveal:
- Explicit or sexual content visible in images
- Copyrighted characters (Disney, Marvel, sports logos) visible on products
- Counterfeit brand logos (Rolex, Louis Vuitton, Gucci) on items
- Hate symbols or extremist imagery
- Weapons (firearms, knives as weapons) vs tools
- Drug paraphernalia (bongs, pipes, rolling trays) vs decorative items
- Items clearly mass-produced (stock photos, identical Alibaba-style imagery)
- Product image does not match the title/description

If images look stock/generic, flag as "possibly-not-handmade".
If image quality is poor but item seems legitimate, approve — new sellers may lack photography skills.

CRITICAL — Image-text mismatch detection:
If the product images do NOT show an actual physical handmade item matching the title and description, REJECT.
Examples of mismatches that MUST be rejected:
- Title says "cutting board" but image shows a graphic, logo, illustration, or non-cutting-board item
- Title says "furniture" but image shows clothing, food, digital art, or unrelated objects
- Images are clearly clipart, SVGs, screenshots, memes, or non-product photography
- Images show a completely different product category than what's described
A legitimate listing should show actual photographs of the physical handmade item described. Stock photos, graphics, illustrations, and unrelated images are not acceptable as primary product photos.

LENIENCY FOR NEW SELLERS:
- Sellers with 0-2 listings get benefit of doubt on borderline cases
- Always reject clear violations regardless of seller experience
- After 3+ listings, apply standard strictness

Respond with ONLY valid JSON, no other text:
{
  "approved": true or false,
  "flags": ["specific-issue-category-keys"],
  "confidence": 0.0 to 1.0,
  "reason": "one-sentence explanation"
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
  } catch (error) {
    console.error('AI review failed:', error instanceof Error ? error.message : error)
    return {
      approved: true,
      flags: ['AI review unavailable — manual spot check recommended'],
      confidence: 0.5,
      reason: 'AI review error — defaulting to approve'
    }
  }
}
