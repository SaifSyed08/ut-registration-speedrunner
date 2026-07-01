# UT Registration SpeedRunner

A tiny Chrome extension for high-pressure course registration windows.

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

## How to use during registration

1. Click the unique-number input field on the registration page.
2. Press **Ctrl + Shift + S** to insert the current unique number.
3. Press **Ctrl + Shift + S** again for the next backup in the same class.
4. Press **Ctrl + Shift + F** to move to the next class.
5. Press **Ctrl + Shift + A** if you overshot a backup.

## Notes

- The extension does not submit anything for you. It only fills the currently focused input or copies the number if no input is focused.
- Shortcuts are handled by the script injected into the current page, rather than Chrome's global extension-command system.
- To use `test-registration-page.html`, open the extension's Details page and enable **Allow access to file URLs** first.
