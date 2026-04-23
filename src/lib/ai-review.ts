import { prisma } from '@/lib/db'

export interface AIReviewResult {
  approved: boolean
  flags: string[]
  confidence: number
  reason: string
  altTexts?: string[]
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
    return { approved: true, flags: [], confidence: 1, reason: 'AI review disabled — no API key', altTexts: [] }
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

IMAGE REVIEW (CRITICAL — be strict):
The PRIMARY function of these images is to show the actual physical handmade product being sold. If the images do not clearly depict the specific product described, REJECT.

REJECT if images contain:
- Graphics, logos, illustrations, SVGs, clipart, or any computer-generated imagery instead of product photos
- Stock photos, screenshots, memes, or other non-product imagery
- Photos of people (headshots, portraits, lifestyle shots) where no product is visible or the person is the focus
- Photos showing a different product than what's described (e.g., title says "cutting board" but image shows a chair, a person, or unrelated item)
- Photos that are clearly not handmade items (commercial product packaging, mass-produced items, branded merchandise photos)

REJECT if the listing has only ONE image and that image does not clearly show the described product.

EXAMPLES OF VIOLATIONS (REJECT THESE):
- Title: "walnut cutting board" + Image: portrait photo of a person → REJECT (image-text-mismatch)
- Title: "custom table" + Image: laurel wreath graphic/logo → REJECT (image-text-mismatch, possibly-not-handmade)
- Title: "wooden bowl" + Image: stock photo from Alibaba → REJECT (mass-produced)
- Title: "handmade earrings" + Image: clipart of earrings → REJECT (not-actual-product)
- Title: "oak desk" + Image: a chair (different product) → REJECT (image-text-mismatch)

EXAMPLES OF VALID LISTINGS (APPROVE):
- Title: "walnut cutting board" + Image: photograph of an actual walnut cutting board on a table → APPROVE
- Title: "custom dining table" + Image: photo of a wooden dining table in a workshop → APPROVE
- Title: "wooden necklace" + Image: photo of a person wearing the wooden necklace (product is focus) → APPROVE

SEXUALIZED CONTENT DETECTION:
Reject ANY images that are clearly sexualized or designed for sexual appeal:
- Swimwear, lingerie, underwear (especially when posed sexually or person is focus)
- Photos of people in revealing clothing where the person is the focus, not a product
- Suggestive poses regardless of clothing
- Any image where the focus is on a person's body rather than a handmade product
This applies even if the image is not technically "explicit" or "nude". Grainline is a woodworking marketplace — product photos should focus on the product.
EXCEPTION: Lifestyle photos showing a product being used (a person wearing a wooden necklace, a person sitting on handmade furniture) are acceptable IF the product is clearly the focus and the person is wearing normal clothing.

When in doubt about whether an image shows the actual product: REJECT. The seller can resubmit with proper product photos.

DESCRIPTION QUALITY:
Flag listings with low-quality descriptions:
- Description is under 20 characters
- Description is just "test", "asdf", "made it", or similar minimal text
- Description provides no useful information about the product (materials, dimensions, process, intended use)

For low-quality descriptions:
- If listing is otherwise legitimate and from a NEW seller (0-2 listings): APPROVE but include flag "low-quality-description"
- If seller has 3+ listings AND description is very low quality: REJECT with reason "Description too brief — please describe materials, dimensions, and any unique features"
- If description is completely missing: REJECT regardless of seller experience

A good description for a handmade item should be at least 50 characters and mention something specific about the product.

LENIENCY FOR NEW SELLERS:
- Sellers with 0-2 listings get benefit of doubt on borderline TEXT cases (not image violations)
- Always reject clear violations regardless of seller experience
- After 3+ listings, apply standard strictness

ALT TEXT GENERATION (REQUIRED):
You MUST generate an "altTexts" array in your JSON response. For each image provided, write a brief SEO-friendly alt text (10-20 words) describing the item shown. Focus on materials, colors, wood species, and the type of woodworking piece. Example: "Hand-carved walnut cutting board with live edge and mineral oil finish". Always include exactly one alt text per image. If no images are provided, return "altTexts": [].

Respond with ONLY valid JSON, no other text:
{
  "approved": true or false,
  "flags": ["specific-issue-category-keys"],
  "confidence": 0.0 to 1.0,
  "reason": "one-sentence explanation",
  "altTexts": ["brief alt text for image 1", "brief alt text for image 2"]
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
        max_tokens: 500,
        temperature: 0.1,
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content ?? ''
    const clean = text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(clean) as AIReviewResult
    console.log(`[ai-review] approved=${result.approved}, flags=${result.flags?.length ?? 0}, altTexts=${result.altTexts?.length ?? 0}`)
    return result
  } catch (error) {
    console.error('AI review failed:', error instanceof Error ? error.message : error)
    return {
      approved: true,
      flags: ['AI review unavailable — manual spot check recommended'],
      confidence: 0.5,
      reason: 'AI review error — defaulting to approve',
      altTexts: [],
    }
  }
}
