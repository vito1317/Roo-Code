# Form UI Guidelines

## Standard Layout

Forms should follow a logical top-to-bottom flow:

```
┌─────────────────────────────────────┐
│ Form Title / Header                 │
├─────────────────────────────────────┤
│ Label 1                             │
│ [Input Field 1                    ] │
│                                     │
│ Label 2                             │
│ [Input Field 2                    ] │
│                                     │
│ Label 3 (optional indicator)        │
│ [Select Dropdown               ▼  ] │
│                                     │
│ [Cancel]            [Submit/Save]   │
└─────────────────────────────────────┘
```

## Verification Checklist

- [ ] Labels above or to the left of inputs (consistent throughout)
- [ ] Required field indicators (asterisk or "required" text)
- [ ] Input fields have consistent width
- [ ] Related fields grouped together (e.g., address fields)
- [ ] Primary action button (Submit) on right or emphasized
- [ ] Cancel/secondary button on left or less prominent
- [ ] Error messages below respective fields

## Style Requirements

- Clear visual hierarchy (headings, sections)
- Adequate spacing between form groups
- Focus states on all interactive elements
- Disabled states for inactive fields
- Loading state on submit button
- Validation feedback (colors, icons)

## Rejection Examples

❌ **REJECT** if:

- Labels below inputs
- Submit button at top of form
- No visual distinction between primary/secondary actions
- Inputs without labels
- Inconsistent field widths without reason

## Common Mistakes

1. **Labels after inputs**: Label should come before the field
2. **Submit at top**: Actions should be at the bottom
3. **No grouping**: Related fields scattered randomly
4. **Missing required indicators**: User can't tell what's mandatory
