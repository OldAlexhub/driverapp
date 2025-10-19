TaxiOps — Driver App

This repository contains the TaxiOps driver app built with Expo + React Native.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
Contents
--------
- `app/` — Expo Router screens and components
- `src/` — hooks, providers, utils, API client
- `assets/` — images, mipmap icons, splash
- `scripts/` — helper scripts (icon generator, etc.)

Quick start
-----------
1. Install dependencies

```bash
npm install
# or yarn
```

2. Start Metro / dev client

If you use Expo dev client:

```bash
expo start --dev-client
```

3. Open the app on your development device using your dev-client or build a dev client with EAS.

Generating icons and adaptive assets
-----------------------------------
We include a small script that generates properly-sized icons and adaptive icon layers using `sharp`.

1. Place a high-resolution icon source at:

```
assets/images/icon-source.png
```

2. Run:

```bash
node ./scripts/generate-icons.js ./assets/images/icon-source.png
```

This produces:
- `assets/images/icon.png` — 1024x1024 app icon
- `assets/images/icon-foreground.png` — foreground layer for adaptive icon
- `assets/images/icon-background.png` — background layer for adaptive icon
- `assets/mipmap-*/ic_launcher.png` at standard sizes

Replace `assets/images/playstore.png` with a branded splash image (e.g. centered "TaxiOps" text/logo) to improve the native splash.

Splash & branding
-----------------
- App display name is set to `TaxiOps` in `app.json`.
- The splash image is `assets/images/playstore.png` and its background color is `#001f3f` by default.
- For best results, provide a splash image sized >=1080x1920 with the logo centered.

Building (EAS)
--------------
This repo uses EAS for native builds. If you need native installers:

```bash
# install eas if needed
npm install -g eas-cli

# build an Android development build
eas build --platform android --profile development
```

Note: after updating native assets (icons/splash), create a fresh EAS build to see the changes in the installed app.

Android logs & troubleshooting
------------------------------
To collect logs while reproducing a crash or ANR on Android, use `adb`:

```bash
# show all logs
adb logcat

# show only errors
adb logcat *:E

# filter by app pid (replace package name if different)
adb logcat --pid=$(adb shell pidof com.oldalex.taxiops.driver)
```

If you use Expo dev client (Metro attached), check the terminal running `expo start` for JS exceptions and stack traces.

Permission behavior note
------------------------
To avoid Android blocking background-started permission prompts (which can cause ANRs), the meter and driver-location hooks check current foreground permission and will not call the system permission prompt if the app is backgrounded. If permission is absent while backgrounded, the hooks return an error asking the user to foreground the app and retry.

Useful commands
---------------
- Start dev client: `expo start --dev-client`
- Generate icons: `node ./scripts/generate-icons.js ./assets/images/icon-source.png`
- Typecheck (TS): `npx tsc --noEmit`

How to update the splash/app name text
-------------------------------------
Replace `assets/images/playstore.png` with an image that contains the stylized text "TaxiOps" (centered). The native splash will display this during cold start.

Need help?
----------
If you paste `adb logcat` output containing the crash or a JS stack trace from Metro, I can analyze and propose fixes.
