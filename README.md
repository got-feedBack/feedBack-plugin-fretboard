# Slopsmith Plugin: Fretboard View

A plugin for [Slopsmith](https://github.com/got-feedback/feedBack) that adds a visual guitar fretboard overlay to the player, showing active notes in real-time as they're played.

## Features

- **Live fretboard** — a horizontal fretboard appears below the highway, lighting up notes as they arrive
- **String colors** — matches the chart color scheme (red, orange, blue, orange, green, purple)
- **Note glow** — active notes glow with a bright halo, fading through sustains
- **Fret numbers** — each active note shows its fret number
- **Full 24-fret range** — shows the entire fretboard with dot markers and double dots at 12th/24th
- **Toggle on/off** — "Fretboard" button in the player controls

## Installation

```bash
cd /path/to/slopsmith/plugins
git clone https://github.com/got-feedback/feedBack-plugin-fretboard.git fretboard
docker compose restart
```

A "Fretboard" button will appear in the player controls when you play a song.

## How It Works

The plugin reads note and chord data from the highway renderer in real-time and draws active notes on a fretboard diagram. Notes light up when they're due to be played and fade through their sustain duration. Chords show all notes simultaneously.

This provides a complementary view to the highway — some players find it easier to see finger positions on a fretboard layout.

## License

MIT
