# Bulkimart Mobile UI — Color Theme Variations

Here are 3 distinct, production-ready color theme variations designed specifically to suit the **Bulkimart** storefront while preserving the exact layout, components, and typography hierarchy.

---

## 🎨 Theme Comparison Gallery

````carousel
![Current Reference: Classic Royal Blue & Energetic Orange](C:/Users/nansi.KHUSHI/.gemini/antigravity-ide/brain/743617ad-a582-46f2-925f-97781965cf2c/.user_uploaded/media_1791681856102.png)
<!-- slide -->
![Theme 1: Fresh Mint & Emerald Green (Organic, Fresh Grocery & Farm Produce)](C:/Users/nansi.KHUSHI/.gemini/antigravity-ide/brain/743617ad-a582-46f2-925f-97781965cf2c/emerald_green_theme_1791682026405.jpg)
<!-- slide -->
![Theme 2: Royal Purple & Warm Amber (Premium Wholesale & High-Conversion Quick Mart)](C:/Users/nansi.KHUSHI/.gemini/antigravity-ide/brain/743617ad-a582-46f2-925f-97781965cf2c/royal_purple_theme_1791682049800.jpg)
<!-- slide -->
![Theme 3: Midnight Obsidian Dark Mode (Cyber Neon Cyan & Glowing Coral)](C:/Users/nansi.KHUSHI/.gemini/antigravity-ide/brain/743617ad-a582-46f2-925f-97781965cf2c/dark_mode_theme_1791682070363.jpg)
````

---

## 🔍 Detailed Theme Breakdown

### 1. Fresh Mint & Emerald Green ("Fresh Grocery & Farm Market")
> [!NOTE]
> **Aesthetic Vibe**: Natural, wholesome, healthy, ultra-fresh quick grocery (similar to Blinkit / BigBasket Fresh).
> Builds trust and appetite for fresh staples, oils, bakery items, and daily essentials.

| Token Role | Hex Code | Visual Application |
| :--- | :--- | :--- |
| **Primary Brand** | `#0A5C36` | Top header gradient, active ShopAll button, main brand typography |
| **Accent Primary** | `#10B981` | Product card `+` buttons, category icon highlights, active tab line |
| **Accent Pale** | `#E6F7F0` | Category badge backgrounds, pill backdrops |
| **Page Background** | `#F4FBF7` | Soft mint-tinted clean off-white background |
| **Card Surface** | `#FFFFFF` | Crisp white cards with soft drop shadows |
| **Text Primary** | `#0D2319` | High-contrast deep spruce body text |

```css
/* CSS Theme Tokens: Fresh Emerald Green */
.theme-emerald-fresh {
  --brand-primary: #0A5C36;
  --brand-primary-dark: #074327;
  --brand-accent: #10B981;
  --brand-accent-hover: #059669;
  --page-background: #F4FBF7;
  --surface-card: #FFFFFF;
  --border-color: #D1EADE;
  --text-primary: #0D2319;
  --text-secondary: #4A6B5D;
}
```

---

### 2. Royal Purple & Warm Amber ("Premium Wholesale & Express Mart")
> [!TIP]
> **Aesthetic Vibe**: Modern, energetic, VIP, high-conversion quick commerce (reminiscent of Zepto & Swiggy Instamart).
> Deep royal indigo creates authority and contrast, while warm golden amber triggers urgency and excitement for deals.

| Token Role | Hex Code | Visual Application |
| :--- | :--- | :--- |
| **Primary Brand** | `#3B1E7E` | Top header bar, category tiles, bottom navigation active item |
| **Secondary Brand**| `#6366F1` | Quick switcher border, secondary icons |
| **Action Accent** | `#F59E0B` | Glowing Add `+` buttons, offer badges, search mic highlight |
| **Pale Surface** | `#F4F0FD` | Category circle backgrounds, active subnav indicators |
| **Page Background** | `#F8F9FE` | Light lavender-tinted pearl background |
| **Text Primary** | `#1E1B4B` | Deep indigo text for sharp readability |

```css
/* CSS Theme Tokens: Royal Purple & Amber */
.theme-royal-purple {
  --brand-primary: #3B1E7E;
  --brand-primary-dark: #2A145C;
  --brand-accent: #F59E0B;
  --brand-accent-hover: #D97706;
  --page-background: #F8F9FE;
  --surface-card: #FFFFFF;
  --border-color: #E6E1F8;
  --text-primary: #1E1B4B;
  --text-secondary: #6366F1;
}
```

---

### 3. Midnight Obsidian Dark Mode ("Cyber Neon Edition")
> [!IMPORTANT]
> **Aesthetic Vibe**: Sleek, high-tech, battery-saving dark interface.
> Perfect for evening grocery shopping and tech-savvy consumers. The glowing neon cyan and warm coral accents pop dramatically against the obsidian canvas.

| Token Role | Hex Code | Visual Application |
| :--- | :--- | :--- |
| **Page Background** | `#0B0F19` | Deep obsidian night background |
| **Card Surface** | `#182234` | Elevated slate card surfaces with subtle outer glow |
| **Primary Accent** | `#06B6D4` | Electric cyan borders, category rings, active subnav pill |
| **Action Accent** | `#FF6B35` | Glowing neon coral Add `+` buttons, active Quick tab |
| **Text Primary** | `#F8FAFC` | Bright white text |
| **Text Secondary** | `#94A3B8` | Cool silver text |

```css
/* CSS Theme Tokens: Midnight Obsidian Dark Mode */
.theme-midnight-dark {
  --brand-primary: #06B6D4;
  --brand-accent: #FF6B35;
  --page-background: #0B0F19;
  --surface-card: #182234;
  --border-color: rgba(6, 182, 212, 0.25);
  --text-primary: #F8FAFC;
  --text-secondary: #94A3B8;
}
```

---

## 🚀 Next Steps

Would you like to:
1. **Apply one of these color themes directly** to the live React application (`forntend/src/modules/User/User.css`)?
2. **Add a Theme Toggle / Switcher** in the app so users can switch between Light, Dark, Emerald Green, and Royal Purple modes?
3. **Customize any specific colors** (e.g. adjustments to header, buttons, or card backgrounds)?
