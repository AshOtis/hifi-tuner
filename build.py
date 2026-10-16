"""Build the Obsidian plugin into dist/ (main.js, styles.css with embedded IBM Plex Mono, manifest.json).
No dependencies: python3 build.py"""
import base64, pathlib, shutil
R = pathlib.Path(__file__).resolve().parent; src = R / 'src'; out = R / 'dist'; out.mkdir(exist_ok=True)
read = lambda f: (src / f).read_text(encoding='utf-8')
main = ("'use strict';\nconst { Plugin, ItemView, Notice, requestUrl, PluginSettingTab, Setting } = require('obsidian');\n\n"
        + '\n'.join(read(f) for f in ['geo.js', 'engine.js', 'ui-min.js', 'globe.js', 'ui-globe.js', 'glue.js']))
(out / 'main.js').write_text(main, encoding='utf-8')
font = base64.b64encode((R / 'fonts' / 'IBMPlexMono-Regular-Latin1.woff2').read_bytes()).decode()
face = f'@font-face {{ font-family: "HFT Mono"; font-weight: 400; font-display: block; src: url(data:font/woff2;base64,{font}) format("woff2"); }}'
(out / 'styles.css').write_text(face + '\n' + read('globe.css') + '\n' + read('extra.css'), encoding='utf-8')
shutil.copy(R / 'manifest.json', out / 'manifest.json')
print('dist/ ready: main.js, manifest.json, styles.css')
