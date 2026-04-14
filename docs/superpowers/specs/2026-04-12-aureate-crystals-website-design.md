# Aureate Crystals Website — Design Spec

## Overview
Premium single-page crystal shop website for Aureate Crystals (TikTok shop with 191 products, 2.2K+ followers, 602 sold). Standalone HTML/CSS/JS with Mystical Luxury aesthetic.

## Visual Direction: Mystical Luxury
- **Background**: Dark (#0a0a0e) with subtle gradients
- **Accent**: Gold (#c9a84c) with gradient variations (#a08530)
- **Secondary accent**: Soft purple (#9b7dd4) for Dream Package section
- **Font**: Cormorant Garamond (300–700 weights)
- **Text**: Light taupe (#d4d0c8), muted (#7a7670), dim (#5a5650)
- **Effects**: Floating particles, soft glows, parallax, shimmer on hover, smooth scroll reveals
- **Existing assets**: Logo SVG/PNG from branding kit, favicons (16/32/48px)

## Site Structure (Single Page, Scroll Navigation)

### 1. Navigation (sticky)
- Logo left, nav links right: SHOP | DREAM PACKAGE | ABOUT | CART (count)
- Glass-morphism background on scroll
- Cart icon shows item count badge

### 2. Hero Section
- Animated floating particles (gold dots)
- Logo reveal animation on load
- Tagline: "Healing · Energy · Transformation"
- Two CTAs: "Shop Crystals" (gold filled) and "Dream Package ✦" (gold outline)
- Subtle radial glow behind logo

### 3. Featured / Best Sellers
- Horizontal carousel of top-selling products (sorted by sold count)
- Products: Agate Druzy Set ($142, 12 sold), Moldavite ($29, 14 sold), Malachite ($57, 10 sold), etc.
- Hover: golden glow border, slight scale-up, shimmer effect
- Click: opens quick-view modal or scrolls to shop section

### 4. Crystal Shop (Full Catalog)
- Grid layout (responsive: 5 cols desktop, 3 tablet, 2 mobile)
- 191 products scraped from TikTok store with: name, price, image URL, rating, sold count
- **Filters**: Chakra association, price range, search by name
- **Sort**: Price (low/high), popularity (sold count), newest
- **Product cards**: Image, name, price, rating stars, "Add to Cart" button
- **Quick view modal**: Larger image, full description, quantity selector, Add to Cart
- Lazy loading for images, pagination or infinite scroll

### 5. Dream Package (Hybrid Questionnaire + Interpretation)
- Distinct purple/gold color scheme to differentiate from shop
- **Step 1 — Describe Your Dream**: Free-text textarea with mystical styling. "Close your eyes and recall..."
- **Step 2 — Guided Questions** (multiple choice, one at a time):
  - Primary emotion in dream (Peace, Fear, Wonder, Confusion, Joy, Longing)
  - Dominant colors (select multiple: Blue, Purple, Green, Gold, White, Red, Black, Silver)
  - Key symbols (Water, Flying, Animals, Crystals, Light, Shadows, Nature, Stars)
  - Time of day in dream (Dawn, Day, Dusk, Night, Timeless)
  - What do you seek? (Healing, Protection, Clarity, Love, Abundance, Transformation)
- **Step 3 — Interpretation**: Poetic/spiritual dream interpretation generated from inputs. Styled as a mystical scroll/card. References dream themes, symbols, and emotional undertones.
- **Step 4 — Crystal Prescription + Frequencies**:
  - 3 recommended crystals from the shop catalog (matched by chakra/property to dream themes)
  - Each crystal card shows: image, name, price, why it was chosen, "Add to Cart"
  - 2-3 healing frequency recommendations (e.g., 432Hz for peace, 528Hz for transformation, 741Hz for intuition)
  - Embedded audio players or links to frequency tracks
  - Option to "Add All Crystals to Cart"

### Crystal-to-Dream Mapping Logic
Curated mapping system (not AI API dependent):
- **Emotions → Crystals**: Peace→Selenite/Moonstone, Fear→Black Tourmaline/Obsidian, Wonder→Labradorite, Clarity→Clear Quartz, Love→Rose Quartz, Abundance→Citrine
- **Symbols → Crystals**: Water→Aquamarine/Blue Lace Agate, Flying→Amethyst/Labradorite, Light→Selenite/Clear Quartz, Nature→Moss Agate/Green Fluorite
- **Chakra alignment**: Map dream themes to chakra system, recommend crystals that align
- **Frequencies**: 396Hz (liberation), 417Hz (change), 432Hz (harmony), 528Hz (transformation/love), 639Hz (connection), 741Hz (intuition), 852Hz (spiritual awakening), 963Hz (divine connection)

### 6. Shopping Cart (Slide-out Panel)
- Slides in from right on cart icon click
- Lists items with: thumbnail, name, quantity (+/- controls), price, remove button
- Subtotal display
- "Checkout with Stripe" button
- Stripe Checkout integration: client-side redirect to Stripe-hosted checkout page
- Products configured as Stripe Payment Links or Checkout Sessions

### 7. About / Footer
- Brief brand story
- Stats: 2.2K+ followers, 602+ crystals sold, 5.0 rating
- Social links: TikTok shop link, Instagram, etc.
- Copyright notice

## Animations & Polish
- **Page load**: Logo fade-in with golden shimmer, particles begin floating
- **Scroll reveals**: Sections fade-in-up as they enter viewport (IntersectionObserver)
- **Product hover**: Border glow, scale 1.03, shimmer sweep across image
- **Dream Package transitions**: Steps crossfade with mystical particle burst between steps
- **Cart slide**: Smooth slide-in/out with backdrop blur
- **Buttons**: Gold shimmer sweep on hover
- **Navigation**: Glass-morphism effect when scrolled past hero

## Technical Approach
- **Single HTML file** with embedded CSS and JS (matches existing crystal-cards pattern)
- **No build tools** — vanilla HTML/CSS/JS
- **Product data**: Hardcoded JSON array of all 191 products (scraped from TikTok)
- **Images**: Reference TikTok CDN URLs directly (hotlinked from store)
- **Fonts**: Google Fonts CDN (Cormorant Garamond)
- **Stripe**: Payment Links (no backend required) — each product gets a Stripe link, cart builds a combined checkout URL
- **Responsive**: Mobile-first, breakpoints at 768px and 1200px
- **Dream Package logic**: Pure JS — curated mapping tables, template-based interpretation text generation
- **No external dependencies** beyond Google Fonts and Stripe.js

## Product Data Structure
```json
{
  "name": "Genuine Moldavite | Authentic Czech Tektite",
  "price": 29.00,
  "image": "tiktok-cdn-url",
  "rating": 5.0,
  "sold": 14,
  "category": "specimen",
  "chakra": ["heart", "third-eye"],
  "properties": ["transformation", "awakening", "high-vibration"],
  "tiktokUrl": "original-listing-url"
}
```

## Out of Scope
- Backend server / database
- User accounts / login
- Order management (handled by Stripe)
- Inventory tracking (manual via Stripe dashboard)
- Blog / content pages
