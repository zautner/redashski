# Changelog

## 0.7.2

### Added
- Open Graph and Twitter Card meta tags on `index.html` and `privacy.html` for rich link previews on X (Twitter), Slack, Discord, etc.
- Branded OG image (`assets/og-image.png`, 1200x630) with dark theme, logo, tagline, and badges
- Uses `summary_large_image` card type for maximum visual impact when shared

## 0.7.1

### Fixed
- Settings gear button in popup header now toggles between quickstart and settings views instead of being a no-op
- Save button is always visible without scrolling — settings is now a separate view from quickstart

## 0.7.0

### Added
- Custom GitHub Pages site replacing the default Jekyll theme
  - New `index.html` landing page with dark theme matching the extension UI
  - Hero section, feature grid, installation steps, architecture overview, permissions table
  - Sticky frosted-glass header with navigation
  - Ambient gradient background glow effects
  - Fully responsive layout
  - `.nojekyll` file to serve plain HTML without Jekyll processing
- Redesigned `privacy.html` with matching dark theme, consistent navigation, and typography

## 0.6.0

### Changed
- Redesigned popup and side panel UI with refined dark theme
  - Richer color palette with improved contrast and warmer accent tones
  - Refined typography scale with better spacing rhythm
  - Polished interactive states with smooth micro-animations (translateY lifts, cubic-bezier easing)
  - Subtle decorative details: header glow line, quickstart side stripe, table header accent
  - Improved card design with better depth, layering, and hover feedback
  - Better data table presentation with softer grid lines and frosted header edge
  - Enhanced form controls with hover states and refined focus rings
  - Stronger glassmorphism effect on settings overlay (blur increased to 8px)
  - Updated SVG logo with bar-chart motif and glowing indicator dot
- Unified design tokens across popup and side panel stylesheets

## 0.5.1

- Initial tracked release
