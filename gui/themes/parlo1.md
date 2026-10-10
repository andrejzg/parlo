# Parlo1

Generated from the current project, including edits awaiting autosave. Return to the [theme index](../themes.md). Install the selected fonts and icons using the setup below; assets are acquired separately from their official sources.

## Font and icon setup

Follow [asset installation](../assets.md) when implementing this theme. Download and configure the selected free assets from their official sources; no font files or icon artwork are bundled. Weights below are the authored requests: load matching static faces or a variable range and report any unavailable weight. Register the exact family aliases below, or map the role tokens to the loader’s actual family.

| Selected font | Roles | Weights | Family stack | Setup |
| --- | --- | --- | --- | --- |
| <code>Open Runde</code> (free) | brand, ui, editorial, data | 400, 700, 900 | <code>"Open Runde", -apple-system, BlinkMacSystemFont, sans-serif</code> | Download and load [Open Runde](https://github.com/lauridskern/open-runde/releases/latest) in the app. |

### Icons

Selected: [Lucide](https://lucide.dev/guide/react/getting-started), filled. Install and wire the selected free pack (React: <code>lucide-react</code>); reuse it if already installed. Use the official adapter for other frameworks.

Preserve icon size, color, weight, style, and accessible names. Match the selected style only where the pack supports it; Lucide’s official pack supplies outlines, so report a filled-style gap rather than claiming exact filled artwork. Keep existing package versions and add only missing packages using the receiving project’s package manager.

## Foundations

```json
{
  "name": "Parlo1",
  "text": {
    "l": {
      "size": 24,
      "lineHeight": 32
    },
    "m": {
      "size": 16,
      "lineHeight": 24
    },
    "s": {
      "size": 14,
      "lineHeight": 20
    },
    "xl": {
      "size": 36,
      "lineHeight": 40
    },
    "xs": {
      "size": 12,
      "lineHeight": 16
    },
    "xxl": {
      "size": 48,
      "lineHeight": 52
    },
    "xxs": {
      "size": 10,
      "lineHeight": 14
    }
  },
  "fonts": {
    "ui": {
      "family": "\"Open Runde\", -apple-system, BlinkMacSystemFont, sans-serif",
      "weights": {
        "heavy": 900,
        "medium": 700,
        "regular": 400
      }
    },
    "brand": {
      "family": "\"Open Runde\", -apple-system, BlinkMacSystemFont, sans-serif",
      "weights": {
        "heavy": 900,
        "medium": 700,
        "regular": 400
      }
    },
    "editorial": {
      "family": "\"Open Runde\", -apple-system, BlinkMacSystemFont, sans-serif",
      "weights": {
        "heavy": 900,
        "medium": 700,
        "regular": 400
      }
    },
    "data": {
      "family": "\"Open Runde\", -apple-system, BlinkMacSystemFont, sans-serif",
      "weights": {
        "heavy": 900,
        "medium": 700,
        "regular": 400
      }
    }
  },
  "border": {
    "l": 0,
    "m": 0,
    "s": 0,
    "none": 0
  },
  "radius": {
    "l": 29,
    "m": 23,
    "s": 16,
    "xl": 42,
    "xs": 8,
    "full": 9999,
    "zero": 0
  },
  "shadows": {
    "l": {
      "x": 0,
      "y": 16,
      "blur": 48,
      "color": {
        "dark": "neutral-1",
        "light": "neutral-10"
      },
      "spread": 0,
      "opacity": 0
    },
    "m": {
      "x": 0,
      "y": 8,
      "blur": 24,
      "color": {
        "dark": "neutral-1",
        "light": "neutral-10"
      },
      "spread": 0,
      "opacity": 12
    },
    "s": {
      "x": 0,
      "y": 2,
      "blur": 4,
      "color": {
        "dark": "neutral-1",
        "light": "neutral-10"
      },
      "spread": 0,
      "opacity": 0
    }
  },
  "spacing": {
    "l": 24,
    "m": 16,
    "s": 12,
    "xl": 32,
    "xs": 8,
    "xxl": 48,
    "xxs": 4,
    "zero": 0
  },
  "animation": {
    "large": {
      "type": "easing",
      "duration": 280,
      "easing": [
        0.16,
        1,
        0.3,
        1
      ],
      "visualDuration": 0.36,
      "bounce": 0.3
    },
    "easing": [
      0.16,
      1,
      0.3,
      1
    ],
    "duration": 160,
    "popupScale": 0.96,
    "pressDistance": 1,
    "type": "easing",
    "visualDuration": 0.2,
    "bounce": 0.2
  },
  "iconStyle": "filled",
  "iconFamily": "Lucide",
  "neutralTone": "warm",
  "buttonRadius": "full",
  "colorEmphasis": 100,
  "letterSpacing": {
    "l": 0.01,
    "m": 0,
    "s": -0.01,
    "xl": 0.02,
    "xs": -0.02
  },
  "primaryForeground": {},
  "primaryActionColor": "neutral-10"
}
```

## light CSS variables

Define these in the app’s existing theme scope for this mode. Keep component styles linked to the variables.

| Variable | Value |
| --- | --- |
| `--theme-name` | Parlo1 |
| `--theme-icon-family` | Lucide |
| `--theme-icon-style` | filled |
| `--toolbar-divider-bleed` | 0 |
| `--focus-ring-outline` | initial |
| `--icon-stroke-width` | 2 |
| `--icon-light-display` | none |
| `--icon-regular-display` | inline |
| `--icon-bold-display` | none |
| `--motion-duration` | 160ms |
| `--motion-easing` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-type` | easing |
| `--motion-visual-duration` | 0.16 |
| `--motion-bounce` | 0.2 |
| `--motion-enabled` | 1 |
| `--motion-small-iterations` | infinite |
| `--motion-large-duration` | 280ms |
| `--motion-large-easing` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-large-type` | easing |
| `--motion-large-visual-duration` | 0.28 |
| `--motion-large-bounce` | 0.3 |
| `--motion-large-iterations` | infinite |
| `--motion-popup-scale` | 0.96 |
| `--motion-press-distance` | 1px |
| `--option-badge-background` | #dd4222 |
| `--option-badge-foreground` | #000000 |
| `--navigation-active-foreground` | #000000 |
| `--emphasis-chart-fill` | #dd422233 |
| `--emphasis-balance-background` | #b6ebd8 |
| `--emphasis-rewards-background` | #07376b |
| `--emphasis-icon-background` | #ffb8da |
| `--emphasis-icon-foreground` | #000000 |
| `--emphasis-type-background` | #dd4222 |
| `--emphasis-type-foreground` | #000000 |
| `--navigation-active-background` | #dd4222 |
| `--surface-raised-image` | none |
| `--surface-raised-shadow` | 0 0 0 0 transparent |
| `--surface-recessed-image` | none |
| `--surface-recessed-shadow` | 0 0 0 0 transparent |
| `--space-zero` | 0px |
| `--space-xxs` | 4px |
| `--space-xs` | 8px |
| `--space-s` | 12px |
| `--space-m` | 16px |
| `--space-l` | 24px |
| `--space-xl` | 32px |
| `--space-xxl` | 48px |
| `--tracking-xs` | -0.02em |
| `--tracking-s` | -0.01em |
| `--tracking-m` | 0em |
| `--tracking-l` | 0.01em |
| `--tracking-xl` | 0.02em |
| `--size-xxs` | 10px |
| `--line-xxs` | 14px |
| `--letter-spacing-xxs` | 0.02em |
| `--size-xs` | 12px |
| `--line-xs` | 16px |
| `--letter-spacing-xs` | 0.01em |
| `--size-s` | 14px |
| `--line-s` | 20px |
| `--letter-spacing-s` | 0.01em |
| `--size-m` | 16px |
| `--line-m` | 24px |
| `--letter-spacing-m` | 0em |
| `--size-l` | 24px |
| `--line-l` | 32px |
| `--letter-spacing-l` | -0.01em |
| `--size-xl` | 36px |
| `--line-xl` | 40px |
| `--letter-spacing-xl` | -0.01em |
| `--size-xxl` | 48px |
| `--line-xxl` | 52px |
| `--letter-spacing-xxl` | -0.02em |
| `--radius-zero` | 0px |
| `--radius-xs` | 8px |
| `--radius-s` | 16px |
| `--radius-m` | 23px |
| `--radius-l` | 29px |
| `--radius-xl` | 42px |
| `--radius-full` | 9999px |
| `--border-none` | 0px |
| `--border-s` | 0px |
| `--border-m` | 0px |
| `--border-l` | 0px |
| `--border-default-color` | #e9e5df33 |
| `--border-shadow-none` | 0 0 0 0 transparent |
| `--border-shadow-s` | 0 0 0 0 transparent |
| `--border-shadow-m` | 0 0 0 0 transparent |
| `--border-shadow-l` | 0 0 0 0 transparent |
| `--font-ui` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-ui-regular` | 400 |
| `--weight-ui-medium` | 700 |
| `--weight-ui-heavy` | 900 |
| `--font-brand` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-brand-regular` | 400 |
| `--weight-brand-medium` | 700 |
| `--weight-brand-heavy` | 900 |
| `--font-editorial` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-editorial-regular` | 400 |
| `--weight-editorial-medium` | 700 |
| `--weight-editorial-heavy` | 900 |
| `--font-data` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-data-regular` | 400 |
| `--weight-data-medium` | 700 |
| `--weight-data-heavy` | 900 |
| `--color-none` | transparent |
| `--color-1` | #dd4222 |
| `--color-1-transparent` | #dd422233 |
| `--color-2` | #07376b |
| `--color-2-transparent` | #07376b33 |
| `--color-3` | #ffb8da |
| `--color-3-transparent` | #ffb8da33 |
| `--color-4` | #b6ebd8 |
| `--color-4-transparent` | #b6ebd833 |
| `--neutral-1` | #ffffff |
| `--neutral-1-transparent` | #ffffff33 |
| `--neutral-2` | #fcfbfa |
| `--neutral-2-transparent` | #fcfbfa33 |
| `--neutral-3` | #f5f4f1 |
| `--neutral-3-transparent` | #f5f4f133 |
| `--neutral-4` | #e9e5df |
| `--neutral-4-transparent` | #e9e5df33 |
| `--neutral-5` | #d2ccbf |
| `--neutral-5-transparent` | #d2ccbf33 |
| `--neutral-6` | #a5a094 |
| `--neutral-6-transparent` | #a5a09433 |
| `--neutral-7` | #837e72 |
| `--neutral-7-transparent` | #837e7233 |
| `--neutral-8` | #595449 |
| `--neutral-8-transparent` | #59544933 |
| `--neutral-9` | #383329 |
| `--neutral-9-transparent` | #38332933 |
| `--neutral-10` | #000000 |
| `--neutral-10-transparent` | #00000033 |
| `--success` | #00c853 |
| `--success-transparent` | #00c85333 |
| `--warning` | #ffea00 |
| `--warning-transparent` | #ffea0033 |
| `--error` | #fc032d |
| `--error-transparent` | #fc032d33 |
| `--shadow-none` | none |
| `--shadow-s` | 0px 2px 4px 0px #00000000 |
| `--shadow-m` | 0px 2px 6px 0px #0000000d, 0px 8px 24px 0px #00000013 |
| `--shadow-l` | 0px 16px 48px 0px #00000000 |
| `--cte-canvas` | #ffffff |
| `--cte-surface` | #fcfbfa |
| `--cte-surface-muted` | #f5f4f1 |
| `--cte-text` | #000000 |
| `--cte-text-muted` | #837e72 |
| `--cte-border` | #e9e5df33 |
| `--cte-accent` | #dd4222 |
| `--cte-accent-text` | #000000 |
| `--cte-danger` | #fc032d |
| `--cte-focus` | #dd4222 |
| `--cte-font` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--cte-font-size` | 14px |
| `--cte-font-weight` | 400 |
| `--cte-line-height` | 20px |
| `--cte-letter-spacing` | 0.01em |
| `--cte-detail-font-size` | 12px |
| `--cte-detail-line-height` | 16px |
| `--cte-detail-letter-spacing` | 0.01em |

## dark CSS variables

Define these in the app’s existing theme scope for this mode. Keep component styles linked to the variables.

| Variable | Value |
| --- | --- |
| `--theme-name` | Parlo1 |
| `--theme-icon-family` | Lucide |
| `--theme-icon-style` | filled |
| `--toolbar-divider-bleed` | 0 |
| `--focus-ring-outline` | initial |
| `--icon-stroke-width` | 2 |
| `--icon-light-display` | none |
| `--icon-regular-display` | inline |
| `--icon-bold-display` | none |
| `--motion-duration` | 160ms |
| `--motion-easing` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-type` | easing |
| `--motion-visual-duration` | 0.16 |
| `--motion-bounce` | 0.2 |
| `--motion-enabled` | 1 |
| `--motion-small-iterations` | infinite |
| `--motion-large-duration` | 280ms |
| `--motion-large-easing` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-large-type` | easing |
| `--motion-large-visual-duration` | 0.28 |
| `--motion-large-bounce` | 0.3 |
| `--motion-large-iterations` | infinite |
| `--motion-popup-scale` | 0.96 |
| `--motion-press-distance` | 1px |
| `--option-badge-background` | #dd4222 |
| `--option-badge-foreground` | #000000 |
| `--navigation-active-foreground` | #000000 |
| `--emphasis-chart-fill` | #dd422233 |
| `--emphasis-balance-background` | #b6ebd8 |
| `--emphasis-rewards-background` | #07376b |
| `--emphasis-icon-background` | #ffb8da |
| `--emphasis-icon-foreground` | #000000 |
| `--emphasis-type-background` | #dd4222 |
| `--emphasis-type-foreground` | #000000 |
| `--navigation-active-background` | #dd4222 |
| `--surface-raised-image` | none |
| `--surface-raised-shadow` | 0 0 0 0 transparent |
| `--surface-recessed-image` | none |
| `--surface-recessed-shadow` | 0 0 0 0 transparent |
| `--space-zero` | 0px |
| `--space-xxs` | 4px |
| `--space-xs` | 8px |
| `--space-s` | 12px |
| `--space-m` | 16px |
| `--space-l` | 24px |
| `--space-xl` | 32px |
| `--space-xxl` | 48px |
| `--tracking-xs` | -0.02em |
| `--tracking-s` | -0.01em |
| `--tracking-m` | 0em |
| `--tracking-l` | 0.01em |
| `--tracking-xl` | 0.02em |
| `--size-xxs` | 10px |
| `--line-xxs` | 14px |
| `--letter-spacing-xxs` | 0.02em |
| `--size-xs` | 12px |
| `--line-xs` | 16px |
| `--letter-spacing-xs` | 0.01em |
| `--size-s` | 14px |
| `--line-s` | 20px |
| `--letter-spacing-s` | 0.01em |
| `--size-m` | 16px |
| `--line-m` | 24px |
| `--letter-spacing-m` | 0em |
| `--size-l` | 24px |
| `--line-l` | 32px |
| `--letter-spacing-l` | -0.01em |
| `--size-xl` | 36px |
| `--line-xl` | 40px |
| `--letter-spacing-xl` | -0.01em |
| `--size-xxl` | 48px |
| `--line-xxl` | 52px |
| `--letter-spacing-xxl` | -0.02em |
| `--radius-zero` | 0px |
| `--radius-xs` | 8px |
| `--radius-s` | 16px |
| `--radius-m` | 23px |
| `--radius-l` | 29px |
| `--radius-xl` | 42px |
| `--radius-full` | 9999px |
| `--border-none` | 0px |
| `--border-s` | 0px |
| `--border-m` | 0px |
| `--border-l` | 0px |
| `--border-default-color` | #413c3233 |
| `--border-shadow-none` | 0 0 0 0 transparent |
| `--border-shadow-s` | 0 0 0 0 transparent |
| `--border-shadow-m` | 0 0 0 0 transparent |
| `--border-shadow-l` | 0 0 0 0 transparent |
| `--font-ui` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-ui-regular` | 400 |
| `--weight-ui-medium` | 700 |
| `--weight-ui-heavy` | 900 |
| `--font-brand` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-brand-regular` | 400 |
| `--weight-brand-medium` | 700 |
| `--weight-brand-heavy` | 900 |
| `--font-editorial` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-editorial-regular` | 400 |
| `--weight-editorial-medium` | 700 |
| `--weight-editorial-heavy` | 900 |
| `--font-data` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--weight-data-regular` | 400 |
| `--weight-data-medium` | 700 |
| `--weight-data-heavy` | 900 |
| `--color-none` | transparent |
| `--color-1` | #dd4222 |
| `--color-1-transparent` | #dd422233 |
| `--color-2` | #07376b |
| `--color-2-transparent` | #07376b33 |
| `--color-3` | #ffb8da |
| `--color-3-transparent` | #ffb8da33 |
| `--color-4` | #b6ebd8 |
| `--color-4-transparent` | #b6ebd833 |
| `--neutral-1` | #000000 |
| `--neutral-1-transparent` | #00000033 |
| `--neutral-2` | #241f16 |
| `--neutral-2-transparent` | #241f1633 |
| `--neutral-3` | #2f2a21 |
| `--neutral-3-transparent` | #2f2a2133 |
| `--neutral-4` | #413c32 |
| `--neutral-4-transparent` | #413c3233 |
| `--neutral-5` | #5b564b |
| `--neutral-5-transparent` | #5b564b33 |
| `--neutral-6` | #888377 |
| `--neutral-6-transparent` | #88837733 |
| `--neutral-7` | #b0aa9e |
| `--neutral-7-transparent` | #b0aa9e33 |
| `--neutral-8` | #d4cec2 |
| `--neutral-8-transparent` | #d4cec233 |
| `--neutral-9` | #f5f4f1 |
| `--neutral-9-transparent` | #f5f4f133 |
| `--neutral-10` | #ffffff |
| `--neutral-10-transparent` | #ffffff33 |
| `--success` | #00c853 |
| `--success-transparent` | #00c85333 |
| `--warning` | #ffea00 |
| `--warning-transparent` | #ffea0033 |
| `--error` | #fc032d |
| `--error-transparent` | #fc032d33 |
| `--shadow-none` | none |
| `--shadow-s` | 0px 2px 4px 0px #00000000 |
| `--shadow-m` | 0px 2px 6px 0px #0000000d, 0px 8px 24px 0px #00000013 |
| `--shadow-l` | 0px 16px 48px 0px #00000000 |
| `--cte-canvas` | #000000 |
| `--cte-surface` | #241f16 |
| `--cte-surface-muted` | #2f2a21 |
| `--cte-text` | #ffffff |
| `--cte-text-muted` | #b0aa9e |
| `--cte-border` | #413c3233 |
| `--cte-accent` | #dd4222 |
| `--cte-accent-text` | #000000 |
| `--cte-danger` | #fc032d |
| `--cte-focus` | #dd4222 |
| `--cte-font` | "Open Runde", -apple-system, BlinkMacSystemFont, sans-serif |
| `--cte-font-size` | 14px |
| `--cte-font-weight` | 400 |
| `--cte-line-height` | 20px |
| `--cte-letter-spacing` | 0.01em |
| `--cte-detail-font-size` | 12px |
| `--cte-detail-line-height` | 16px |
| `--cte-detail-letter-spacing` | 0.01em |

## Authored component assignments

These are project edits. The [component reference](parlo1-components.md) includes the effective assignments with defaults and shared parts resolved.

```json
{
  "componentTokens": {
    "button:ghost:rest": {
      "paddingX": "l",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "button:danger:rest": {
      "paddingX": "l",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "input:default:rest": {
      "paddingX": "m",
      "background": "neutral-3",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "button:outline:rest": {
      "paddingX": "l",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "button:primary:rest": {
      "paddingX": "l",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "select:default:rest": {
      "paddingX": "m",
      "background": "neutral-3",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "button:secondary:rest": {
      "paddingX": "l",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "combobox:default:rest": {
      "paddingX": "m",
      "background": "neutral-3",
      "paddingTop": "s",
      "paddingBottom": "s"
    },
    "menu:default:part:option:rest": {
      "paddingX": "xs",
      "paddingTop": "xs",
      "paddingLeft": "xs",
      "paddingRight": "xs",
      "paddingBottom": "xs"
    },
    "slider:default:part:thumb:rest": {
      "controlSize": "l"
    },
    "slider:default:part:track:rest": {
      "controlSize": "xl"
    },
    "switch:default:part:control:rest": {
      "controlSize": "xl"
    },
    "combobox:default:part:option:rest": {
      "paddingX": "xs",
      "paddingTop": "xs",
      "paddingLeft": "xs",
      "paddingRight": "xs",
      "paddingBottom": "xs"
    },
    "menu:default:part:option:selected": {
      "paddingX": "xs",
      "paddingTop": "xs",
      "paddingLeft": "xs",
      "paddingRight": "xs",
      "paddingBottom": "xs"
    },
    "otp-field:default:part:input:rest": {
      "paddingX": "s",
      "paddingTop": "xs",
      "paddingLeft": "s",
      "paddingRight": "s",
      "paddingBottom": "xs"
    },
    "checkbox:default:part:control:rest": {
      "controlSize": "l"
    },
    "autocomplete:default:part:input:rest": {
      "paddingX": "s",
      "paddingTop": "s",
      "paddingLeft": "s",
      "paddingRight": "s",
      "paddingBottom": "s"
    },
    "autocomplete:default:part:option:rest": {
      "paddingX": "xs",
      "paddingTop": "xs",
      "paddingLeft": "xs",
      "paddingRight": "xs",
      "paddingBottom": "xs"
    },
    "combobox:default:part:option:selected": {
      "paddingX": "xs",
      "paddingTop": "xs",
      "paddingLeft": "xs",
      "paddingRight": "xs",
      "paddingBottom": "xs"
    },
    "autocomplete:default:part:popover:rest": {
      "radius": "s"
    },
    "autocomplete:default:part:option:selected": {
      "paddingX": "xs",
      "paddingTop": "xs",
      "paddingLeft": "xs",
      "paddingRight": "xs",
      "paddingBottom": "xs"
    }
  },
  "componentVariants": {}
}
```
