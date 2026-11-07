# Change Log

## [1.4.1] — Empty "Code Quality" click showed nothing (fixed)

- **Wajah:** aapki file mein Code Quality ke **0 issues** thay —
  quality sirf tab milti hai jab function 50+ lines ho, complexity
  10 se zyada ho, line 120+ characters ho, 3-digit magic number
  ho, nesting 5+ levels ho, ya 6-line duplicate block ho. Aapki
  choti test functions in mein se kisi par poori nahi utarti thin,
  is liye category khaali thi. Magar khaali category ka expand
  arrow hi nahi banta tha (CollapsibleState.None), is liye click
  par kuch nahi khulta tha — ye UI bug tha, scan ka nahi.
- **Fix:** khaali categories ab bhi expand hoti hain aur andar
  likha hota hai "No code quality issues" (aur baqi categories
  ke liye bhi aisa hi). Baqi categories is liye khulti thin ke
  un mein issues thay, is liye un ke saath number likha tha.
- **Doosri khamosh jagah bhi fix:** "AI Code Quality Review"
  command agar AI provider configure na ho to pehle chup chap
  kuch nahi karta tha — ab saaf warning deta hai ke pehle
  "Configure AI Provider" se key dein.

## [1.4.0] — Missing headers / dependencies + progress bar

- **Feature 1 — Missing header / import, auto-install ya link:**
  Naya command `DevPilot: Check & Install Missing Dependencies`
  (sidebar Actions mein bhi hai). Ye file ke `#include`, Python
  `import` aur JS/TS `import` parhta hai, phir waqai check karta
  hai — Python ke liye `import` chala kar, JS ke liye
  `node_modules` dekh kar, C/C++ ke liye compiler snippet se —
  ke kia system mein hai ya nahi. Jo missing ho, usay tick karke
  install kar sakte hain: pip / npm command seedha chalega, apt
  (sudo) terminal mein khulega taake password wahan dein, aur
  jis ka koi command na ho (ya OS par na ho) us ka official
  download link khul jayega. System headers (stdio.h, vector)
  aur Python stdlib (os, json) ko kabhi install ke liye nahi
  poocha jata. Scan mein local (quoted) header jo project mein
  na mile, woh DP601 error ke tor par bhi nazar aata hai.
- **Feature 2 — Testing ke missing dependencies, test se PEHLE:**
  `DevPilot: Run Tests` ab test chalane se pehle check karta
  hai — misal pytest missing ho ya `node_modules` na ho — aur
  poochta hai: Install karun, command/link dikhaun, ya phir
  bhi test chalaun. Install ho jaye to phir test chalte hain.
  Ye check `devpilot.dependencies.checkBeforeTests` se band bhi
  ho sakta hai, aur `devpilot.dependencies.autoInstall` on karne
  par install bina pooche ho jata hai (default: pooch kar).
- **Progress bar — % aur waqt ke saath:** Scan pehle se
  progress dikhata tha, ab us mein % (jaise 45% — 9/20 file)
  aur aakhir mein total waqt (jaise "in 2.3s") bhi hai. Run
  Tests mein pehle progress bar khaali tha — ab us mein bhi
  steps ke saath % aur total waqt aata hai: dependencies check
  → test runner → ticked tools → done. Dependency check
  command mein bhi har dependency ke saath % dikhta hai.

## [1.3.2] — Reported "command not found" errors investigated

- **Ye errors naye code ke nahi thay:** "Test generation coming in
  v0.2", "Documentation generation coming in v0.2", aur
  `devpilot.analyzeBug` / `devpilot.configureTestTools` /
  `devpilot.scanCurrentFile` not found — ye sab purani v0.1.0 ki
  dist se aate hain (us mein sirf 14 commands thay, aur test/docs
  sirf placeholder messages thay). v1.3.2 ki VSIX mein ye messages
  kahin nahi hain, aur teenon commands manifest + compiled dist
  dono mein maujood hain (37 commands, sab ke activation events).
  Agar ye errors nazar aayen to matlab VS Code mein purani v0.1.0
  hi chal rahi hai — neechay diye steps se sirf nayi VSIX install
  karein.
- **F5 ka asal bug fix:** `.vscode/tasks.json` abhi tak purani
  template ki thi — us mein `watch:tsc`, `watch:esbuild` aur
  `watch-tests` scripts thin jo `package.json` mein exist hi nahi
  karti thin, is liye F5 se purani dist chal sakti thi. Ab default
  build task `npm: compile` hai (jo exist karta hai) aur watch task
  `npm: watch` hai.

## [1.3.1] — Bug fixes found in the pre-zip audit

- **Scan exclusions ab kaam karti hain:** `devpilot.scan.exclusions`
  pehle dead thi (filter mein `&& false` tha) — node_modules/dist/
  venv waghera ab waqai skip hote hain, ek glob matcher ke saath
  (6/6 matcher checks pass).
- **`devpilot.refresh` ki activation event missing thi** — add kar di.

## [1.3.0] — Follow Me + professional logo

- **Sidebar ke neechay "Follow Me":** DevPilot panel ke sab se neechay
  Follow Me section hai — GitHub (@datascientist970) aur LinkedIn
  (dawood406) par click karne se profile browser mein khulti hai.
  Ye commands Command Palette se bhi milte hain: `DevPilot: Follow on
  GitHub` aur `DevPilot: Follow on LinkedIn` (kul commands ab 37).
- **Naya professional logo:** purana gradient + spark + check badge
  wala SVG hata diya. Naya logo flat hai — dark slate tile, saaf
  safed `</>` brackets aur sirf ek teal slash accent. Activity icon
  ke liye monochrome version bhi hai. Marketplace icon (`media/icon.png`,
  128×128) isi naye SVG se banaya gaya hai.

## [1.2.0] — New languages + full SQL + notebook + report export

- **Nayi languages (kul ab 24):** HTML (`.html`, `.htm`), CSS
  (`.css`, `.scss`), R (`.r`), Scala (`.scala`, `.sc`), Perl
  (`.pl`, `.pm`) aur Jupyter Notebook (`.ipynb`).
- **HTML analysis:** unclosed/mismatched tags (DP402/DP403), duplicate
  id (DP404), img bina alt (DP405), deprecated tags — font/center/
  marquee waghera (DP406), `<html>` bina lang aur `<head>` bina
  `<title>` (DP407).
- **CSS analysis:** duplicate selector (DP501), duplicate property
  (DP502), empty rule (DP503), `!important` (DP504), defined magar
  unused CSS variable (DP505).
- **SQL full:** pehle sirf basic checks thay. Ab CREATE PROCEDURE /
  FUNCTION / TRIGGER / VIEW / TABLE definitions detect hoti hain aur
  unused procedures DP106 se flag hoti hain, plus SELECT * (DP301),
  DELETE/UPDATE bina WHERE (DP302), table bina PRIMARY KEY (DP303),
  JOIN bina ON (DP304).
- **Jupyter Notebook full:** `.ipynb` ke code cells ko scan kiya jata
  hai, har issue wapas us cell ki asal JSON line par map hoti hai
  (line number sirf cell number nahi), aur doosri cell mein declare
  ya use hone wala variable unused/undefined flag nahi hota.
  Run Current File notebook ke cells ko Python mein extract karke
  chalata hai (notebook ko in-place execute nahi karta).
- **Run Current File mazeed:** Perl (`perl`), R (`Rscript`) aur Scala
  (`scala`) bhi single file run hote hain; HTML/CSS par saaf message
  hai ke browser/test se chalain.
- **Syntax checks mazeed:** `perl -c`, Rscript parse, aur notebook
  JSON + Python compile check — external tool na ho to silently skip.
- **Export Scan Report (naya command, kul 35):** `DevPilot: Export
  Scan Report` — Markdown ya JSON report workspace mein
  `devpilot-report.md` / `devpilot-report.json` ke naam se banata aur
  kholta hai.
- **Docs mazeed:** HTML (`<!-- -->`), CSS (`/* */`), R (`#`),
  Scala (Javadoc + class/object/trait) aur Perl (`#`) ke liye local
  documentation generation.
- **Note:** Zig, Elixir aur Haskell is release mein add nahi kiye —
  user ne sirf HTML/CSS, R, Scala, Perl aur Jupyter add karne ko kaha tha.

## [1.1.0] — Gaps closed + testing tools

- **Fix Selected Issues:** sidebar mein Ctrl/Cmd-click se kai issues
  select karein, ya file mein QuickPick se tick karein — sirf wohi issues
  fix honge. Sidebar tree ab multi-select support karta hai.
- **Bug Analysis aur Code Quality Review:** `DevPilot: Analyze Bug
  (root cause)` aur `DevPilot: AI Code Quality Review` alag commands ban
  gaye — pehle ye prompts code mein thay magar command se wired nahi thay.
- **Test modes:** Generate Tests ab poochta hai — Full, Edge cases only,
  Input validation only, ya Regression only — aur har mode ke liye alag
  AI prompt aur local template hai.
- **Local docs poori:** Generate Documentation (bina AI) ab module header
  + class docs + function docs teenon lagata hai. Pehle sirf functions thay.
- **Run Current File:** C/C++ (gcc/g++), Java (javac/java) aur Rust
  (rustc) bhi compile karke run hote hain, temp binary ke saath.
- **Testing tools (tick karke auto-run):** Settings
  `devpilot.test.enabledTools` ya `DevPilot: Configure Test Tools`
  (multi-select QuickPick) se tick karein — Playwright, Selenium, Cypress,
  Postman, Bruno, Insomnia, RestAssured, Appium, Maestro, Testim, Mabl,
  GitHub Copilot, Apache JMeter, K6, Jira, TestRail, Xray, Zephyr.
  `DevPilot: Run Tests` par ticked tools auto chalte hain, project ke apne
  test runner ke saath. Custom command ke liye
  `devpilot.test.customCommands` hai (Selenium/Appium/Insomnia aur
  Jira/TestRail/Xray/Zephyr reporting ke liye).
- **Imandari wali reporting:** jo tool install nahi, detect nahi hua, ya
  SaaS/management tool hai (Testim, Mabl, Copilot, Jira, TestRail, Xray,
  Zephyr), woh "skipped" ya "external" report hota hai — kabhi fake pass
  nahi. Tool na milne par install/setup hint dikhta hai.

## [1.0.0] — Complete release

- **All languages, one engine:** Python, C, C++, JavaScript, TypeScript,
  JSX, TSX, Java, C#, Go, Rust, PHP, Ruby, Swift, Kotlin, Dart, Lua, SQL.
  The previous build only registered Quick Fix for Python and its
  `src/extension.ts` contained scanner helpers but no activation code —
  both are fixed: activation is restored and Quick Fix now works for every
  supported language.
- **Fixed duplicate-code detection:** the old analyzer required every line
  in a block to be at least 40 characters, so it almost never fired. It now
  uses meaningful lines (comments/strings stripped, blanks and bare
  punctuation skipped) with a configurable block size (default 6).
- **Fixed settings mismatch:** v0.1.0 declared `devpilot.python.path` /
  `devpilot.enable.ruff` in `package.json` but read `devpilot.pythonPath` /
  `devpilot.enableRuff` in code. Settings are now unified, with legacy
  names still honoured as fallbacks.
- **New analyzers:** security checks, type-issue category, language-aware
  naming conventions, per-language unused/undefined detection, C/C++
  function detection, and a generic fallback so unknown extensions still
  get the built-in checks.
- **External tools (optional):** cppcheck, clang-tidy, ESLint, `go vet`,
  `rustc`, `php -l`, `ruby -c`, plus Ruff and Mypy for Python. Missing
  tools are skipped silently.
- **Fixing:** multiple fix candidates (local + AI), Fix All, Fix Current,
  confirmation + syntax validation before applying, WorkspaceEdit into the
  original file, auto-save, post-fix re-scan, and applied / skipped /
  failed reporting.
- **Testing & validation:** test generation (AI or local template),
  detected test runners (pytest, npm, go test, cargo test, Maven, Gradle,
  PHPUnit, dotnet), run current file for runtime errors, Verify Fix.
- **Documentation:** AI documentation, local doc-comment fallback (works
  with no API key), README generation from real project files.
- **AI:** OpenAI, Gemini, Claude, Groq via Secret Storage; code review,
  security review, optimization, refactoring, root-cause analysis,
  context-aware related-file inclusion.
- **Sidebar:** Actions, Project Health, and all issue categories; editor
  context menu; new keybindings.
- **New logo:** `media/devpilot.svg` (gradient tile, `</>` code brackets,
  pilot spark, quality check badge) plus a monochrome activity-bar icon
  and a PNG marketplace icon.

## [0.1.0]

- Initial release: Python-focused static analysis (Ruff, Mypy, basic
  Python/JS/TS checks), AI explanation and fixes, sidebar tree.
