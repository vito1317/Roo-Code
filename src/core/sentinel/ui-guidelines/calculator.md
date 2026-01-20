# Calculator UI Guidelines

## Standard Layout

A standard calculator follows the numpad layout:

```
Row 1: C    /    *    -     (Clear and operators)
Row 2: 7    8    9    +     (Top number row)
Row 3: 4    5    6          (Middle number row)
Row 4: 1    2    3    =     (Bottom number row)
Row 5: 0         .          (Zero and decimal)
```

## Verification Checklist

For EACH row, verify the elements match:

- [ ] **Row 1**: Clear button (C/AC) on left, operators (/, \*, -) follow
- [ ] **Row 2**: Numbers 7, 8, 9 in order, left to right
- [ ] **Row 3**: Numbers 4, 5, 6 in order, left to right
- [ ] **Row 4**: Numbers 1, 2, 3 in order, equals (=) button
- [ ] **Row 5**: Zero (0) larger/spanning, decimal point (.)

## Style Requirements

- Display screen at top showing numbers
- Number buttons: neutral color (gray/white)
- Operator buttons: accent color (orange/blue)
- Clear button: distinctive (red/contrasting)
- Equals button: prominent, possibly larger
- Button hover/active states required
- Minimum padding between buttons

## Rejection Examples

❌ **REJECT** if:

- Numbers not in 7-8-9 / 4-5-6 / 1-2-3 order
- Operators scattered among numbers
- Zero not at bottom
- Missing display screen
- No visual distinction between number and operator buttons

## Common Mistakes

1. **Inverted number order**: 1-2-3 on top instead of 7-8-9
2. **Operators mixed with numbers**: 8, 9, -, 4 in same row
3. **Random button placement**: no logical grouping
4. **Missing zero span**: 0 button same size as others
