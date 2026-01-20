# Navigation UI Guidelines

## Standard Layouts

### Horizontal Navigation (Top)

```
┌─────────────────────────────────────────────────┐
│ Logo    [Home] [Products] [About] [Contact]  🔍 │
├─────────────────────────────────────────────────┤
│                                                 │
│                 Page Content                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Vertical Navigation (Sidebar)

```
┌──────────┬──────────────────────────────────────┐
│ Logo     │                                      │
├──────────┤                                      │
│ Home     │                                      │
│ Products │        Page Content                  │
│ About    │                                      │
│ Contact  │                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

## Verification Checklist

- [ ] Navigation in ONE location (top OR left, never both)
- [ ] Logo in top-left corner
- [ ] Current page/section highlighted
- [ ] All links clearly distinguishable
- [ ] Responsive behavior defined (hamburger menu on mobile)
- [ ] Consistent order across pages

## Style Requirements

- Active state clearly visible
- Hover states on all links
- Adequate clickable area (44px minimum)
- Visual separation from content
- Sticky/fixed option for long pages

## Rejection Examples

❌ **REJECT** if:

- Navigation split between top AND left
- No indication of current page
- Links look like plain text (no distinction)
- Inconsistent navigation between pages
- Logo not linking to home

## Common Mistakes

1. **Split navigation**: Some items top, others left
2. **No active state**: User can't tell where they are
3. **Hidden navigation**: Hamburger menu on desktop
4. **Inconsistent ordering**: Items in different order on different pages
