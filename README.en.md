# FX Senshi Kurumi — Trading Simulator (Fan Game)

An unofficial fan game based on *FX戦士くるみちゃん* by Demunyan / Tansan Daisuki.

A single-file, zero-dependency FX (forex margin) trading simulator that teaches
leverage, margin requirements, margin calls, forced liquidation and the danger
of trading with borrowed money — plus an LLM-driven AI rival you can plug your
own API key into.

- **Web version**: `dist/index.html` — one self-contained file, opens offline
- **Android APK**: `dist/FX战士久留美.apk` — installable, native HTTP bridge bypasses CORS for AI

See [README.md](README.md) (Chinese) for full documentation.

## Quick build

```sh
node build.js                    # web version  → dist/index.html
export JAVA_HOME=/path/to/jdk17
python3 tools/build_apk.py       # APK          → dist/FX战士久留美.apk
sh test/run-all.sh               # 409 tests
```

## License

Source code: MIT. Original characters and story: © Demunyan / Tansan Daisuki / KADOKAWA.
See [NOTICE.md](NOTICE.md).
