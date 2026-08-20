# UT Registration SpeedRunner

A Chrome extension that helps UT students register faster by organizing Unique Numbers, backups, and registration shortcuts in one place.

![Chrome Web Store Version](https://img.shields.io/chrome-web-store/v/ppolilopnfojilddopmkenbaojhpfjbl?label=Chrome%20Web%20Store)
![Chrome Web Store Users](https://img.shields.io/chrome-web-store/users/ppolilopnfojilddopmkenbaojhpfjbl)
![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/ppolilopnfojilddopmkenbaojhpfjbl)
![License](https://img.shields.io/github/license/SaifSyed08/ut-registration-speedrunner)
![Last Commit](https://img.shields.io/github/last-commit/SaifSyed08/ut-registration-speedrunner)

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/ut-registration-speedrunn/ppolilopnfojilddopmkenbaojhpfjbl)
·
[Try the Practice Page](https://saifsyed08.github.io/ut-registration-speedrunner/)
·
[Report an Issue](https://github.com/SaifSyed08/ut-registration-speedrunner/issues)

## Hotkeys

- **Ctrl + Shift + A**: previous backup in the current class column
- **Ctrl + Shift + S**: replace the focused input with the current unique number, then advance down that class column
- **Ctrl + Shift + F**: switch to the next class column

## How to install

1. Unzip the folder.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** in the top-right.
4. Click **Load unpacked**.
5. Select the unzipped `ut-registration-speedrunner` folder.
6. Click the extension icon, enter your classes and unique numbers, and make sure Registration Mode is on.

After changing extension files, click **Reload** on `chrome://extensions` and refresh any registration tabs that were already open.

## Registration links

- Actual registration: https://utdirect.utexas.edu/registration/chooseSemester.WBX
- Practice mock page: https://saifsyed08.github.io/ut-registration-speedrunner/index.html

## How to use during registration

1. Click the unique-number input field on the registration page.
2. Press **Ctrl + Shift + S** to insert the current unique number.
3. Press **Ctrl + Shift + S** again for the next backup in the same class.
4. Press **Ctrl + Shift + F** to move to the next class.
5. Press **Ctrl + Shift + A** if you overshot a backup.

## Auto-submit (optional)

Off by default. In the popup, flip **Auto-submit** on and every **Ctrl+Shift+S** paste will also click the page's **Submit** button for you, right after the number is inserted. This lets you go through a whole queue of classes back-to-back without touching the mouse.

- Turning it on requires an extra confirmation dialog, since it removes your last manual check before a registration action fires.
- It only fires after the number was actually typed into a focused input — not when the number was only copied to your clipboard because nothing was focused.
- It looks for a submit button inside the same `<form>` as the field you pasted into first, then falls back to any submit button on the page.
- Registration on the real UT system processes one action (one unique number) per Submit click, then reloads/updates the page — auto-submit speeds up that per-class loop, it doesn't turn multiple classes into a single request.
- Double-check your class list and unique-number order in the popup before you turn this on. With auto-submit on there's no confirmation step between paste and submit, so a wrong or mis-ordered unique number gets submitted immediately.

## Notes

- With auto-submit off (the default), the extension does not submit anything for you. It only fills the currently focused input or copies the number if no input is focused.
- Shortcuts are handled by the script injected into the current page, rather than Chrome's global extension-command system.
- The practice mock page is not the real registration page and does not submit anything to UT, so it's a safe place to try auto-submit before using it for real.

## Privacy

UT Registration SpeedRunner stores course names, Unique Numbers, positions, and settings locally in your browser using Chrome storage. The extension does not collect, sell, transmit, or remotely store user data. Clipboard access is only used to write selected Unique Numbers when requested by the user.
