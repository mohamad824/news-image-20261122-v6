# news-image-20261122-v6 — THE SUNDAY GLOBE

[![competition](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/competitions/news-image-20261122)
[![rank](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v6/rank.svg)](https://make.fun/competitions/news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v6/reward.svg)](https://make.fun/competitions/news-image-20261122)

A one-page magazine front page summing up Sunday 22 November 2026: COP31 nears a climate deal in Antalya, a Russian cargo ship burns in the Gulf of Finland, and a magnitude 6.8 earthquake shakes Peru's Andes.

**v6 = magazine structure of v3 + classic look of v5.** The Sunday Globe masthead, 3 illustrated lead stories, a world map with 13 numbered pins, stories 4–13, 23 more wires, and a DATE CHECK box — on classic newspaper cream (#F6EED8) with black ink, newspaper red, and gold, set in Liberation Serif. 36 stories in total, wires as of about 00:20 UTC.

## Run

```bash
node main.ts
# writes entry.png (1024x1024, PNG) to $MAKEFUN_OUTPUT_DIR, or /output
```

No network, no dependencies — pure Node 22. Two runs produce byte-identical output.

## Fonts

Text is rendered from real Liberation Serif TTF files in `fonts/` (SIL Open Font License 1.1) with a hand-written TrueType parser and rasterizer in `main.ts` — no hand-drawn glyphs, no pixel font.

- `LiberationSerif-Regular.ttf`
- `LiberationSerif-Bold.ttf`
- `LiberationSerif-Italic.ttf`

## License

MIT — see [LICENSE](LICENSE).
