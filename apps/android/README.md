# Parhiba — Android app

Native Android client (Kotlin + Jetpack Compose) for Parhiba. It talks
to the same `/api/v1/*` surface the web app uses; there is no Android-specific
backend.

## Status

**Phase 0 — scaffold.** The project opens in Android Studio and builds a
placeholder Compose screen. Networking, auth, and the reader are subsequent
phases (see the repo task list / the `apps/android` tickets).

## Prerequisites

- **Android Studio** (Ladybug or newer).
- **JDK 17 or 21.** The Android Gradle Plugin does **not** support JDK 23.
  Point Studio at a 17/21 JDK (Settings → Build Tools → Gradle → Gradle JDK),
  or set `JAVA_HOME` to one for command-line builds.
- **Android SDK** (installed via Android Studio). On first open, Studio writes
  `local.properties` with `sdk.dir` — that file is git-ignored.

## First-time bootstrap (Gradle wrapper)

The Gradle wrapper **jar** is not committed (it's a binary). Generate the full
wrapper once:

- **Easiest:** open `apps/android` in Android Studio and let it sync — Studio
  creates `gradlew`, `gradlew.bat`, and `gradle/wrapper/gradle-wrapper.jar`
  (the pinned version is already set in `gradle/wrapper/gradle-wrapper.properties`).
- **CLI alternative** (needs a system Gradle): `cd apps/android && gradle wrapper`

Commit the generated wrapper files — CI (`.github/workflows/android.yml`) runs
`./gradlew` and needs them.

## Build & run

```bash
cd apps/android
./gradlew assembleDebug          # build the debug APK
./gradlew installDebug           # install on a running emulator/device
./gradlew testDebugUnitTest      # JVM unit tests
./gradlew lintDebug              # Android lint
```

Or just hit ▶ Run in Android Studio with an emulator selected.

## Talking to the dev backend

Run the web + nlp stack on the host (`make dev-native` at the repo root →
SvelteKit on `:5173`). The debug build's API base URL is **`http://10.0.2.2:5173/`**
— `10.0.2.2` is how the Android emulator reaches the host's `localhost`. The
value is a `BuildConfig.API_BASE_URL` field set per build type in
`app/build.gradle.kts`. On a physical device, change it to your machine's LAN IP.

## Conventions / things to know

- **`applicationId` is `com.ciareader.reader`.** Change it now if you want a
  different package — it's baked into many paths once code grows.
- **Single `:app` module** for v1. We'll split into feature modules later if
  build times warrant it.
- **Versions** live in `gradle/libs.versions.toml` (the version catalog). Bump
  there. The pinned set is a known-good starting matrix — let Gradle sync
  reconcile and nudge anything your installed tooling prefers.
- The app is **excluded from the pnpm workspace** (`pnpm-workspace.yaml`) so
  pnpm never treats it as a node package.

## Module layout (current)

```
apps/android/
├── settings.gradle.kts
├── build.gradle.kts            # root, plugins (apply false)
├── gradle.properties
├── gradle/libs.versions.toml   # version catalog
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/ciareader/reader/
        │   ├── CiaReaderApp.kt   # @HiltAndroidApp
        │   ├── MainActivity.kt   # Compose entry point
        │   └── ui/theme/         # Material 3 theme
        └── res/values/           # strings, window theme
```
