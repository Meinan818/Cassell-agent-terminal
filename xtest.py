#!/usr/bin/env python3
"""Minimal X11 automation via ctypes + XTest. No extra deps.

Usage:
  xtest.py click X Y        # move mouse to X,Y and left-click
  xtest.py move X Y         # move mouse only
  xtest.py type "text"      # type ASCII text (shift handled)
  xtest.py key Escape       # press one keysym by name
  xtest.py key ctrl+l       # modifier combo (ctrl/alt/shift + key)
  xtest.py sleep SECONDS
"""
import ctypes
import sys
import time

x11 = ctypes.CDLL("libX11.so.6")
xtest = ctypes.CDLL("libXtst.so.6")

x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeycodeToKeysym.restype = ctypes.c_ulong
x11.XKeycodeToKeysym.argtypes = [ctypes.c_void_p, ctypes.c_ubyte, ctypes.c_int]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]

xtest.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtest.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtest.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

dpy = x11.XOpenDisplay(None)
assert dpy, "cannot open display"
root = x11.XDefaultRootWindow(dpy)


def flush():
    x11.XFlush(dpy)


def key_event(keycode, down):
    xtest.XTestFakeKeyEvent(dpy, keycode, 1 if down else 0, 0)
    flush()
    time.sleep(0.012)


def keycode_for_keysym(ks):
    return x11.XKeysymToKeycode(dpy, ks)


def press_keysym(name):
    ks = x11.XStringToKeysym(name.encode())
    assert ks, f"unknown keysym {name}"
    kc = keycode_for_keysym(ks)
    key_event(kc, True)
    key_event(kc, False)


CHARMAP = {
    ":": "colon", ".": "period", "/": "slash", "-": "minus", "_": "underscore",
    "=": "equal", "+": "plus", "?": "question", "@": "at", "#": "numbersign",
    "!": "exclam", "&": "ampersand", "*": "asterisk", "(": "parenleft",
    ")": "parenright", "[": "bracketleft", "]": "bracketright",
    "{": "braceleft", "}": "braceright", ";": "semicolon",
    "'": "apostrophe", '"': "quotedbl", ",": "comma", "<": "less",
    ">": "greater", "~": "asciitilde", "`": "grave", "\\": "backslash",
    "|": "bar", "^": "asciicircum", "$": "dollar", "%": "percent",
    " ": "space",
}


def type_char(ch):
    name = CHARMAP.get(ch, ch)
    ks = x11.XStringToKeysym(name.encode())
    if not ks:
        return
    kc = keycode_for_keysym(ks)
    # level 1 keysym == target -> needs shift
    need_shift = x11.XKeycodeToKeysym(dpy, kc, 1) == ks
    shift_kc = keycode_for_keysym(x11.XStringToKeysym(b"Shift_L"))
    if need_shift:
        key_event(shift_kc, True)
    key_event(kc, True)
    key_event(kc, False)
    if need_shift:
        key_event(shift_kc, False)


def type_text(text):
    for ch in text:
        if ch == "\n":
            press_keysym("Return")
        else:
            type_char(ch)


def scroll(x, y, clicks):
    # clicks > 0: down, < 0: up (XTest button 5/4)
    xtest.XTestFakeMotionEvent(dpy, -1, x, y, 0)
    flush()
    btn = 5 if clicks > 0 else 4
    for _ in range(abs(clicks)):
        xtest.XTestFakeButtonEvent(dpy, btn, 1, 0)
        flush()
        time.sleep(0.03)
        xtest.XTestFakeButtonEvent(dpy, btn, 0, 0)
        flush()
        time.sleep(0.03)


def dblclick(x, y):
    click(x, y)
    time.sleep(0.08)
    click(x, y)


def click(x, y):
    xtest.XTestFakeMotionEvent(dpy, -1, x, y, 0)
    flush()
    time.sleep(0.05)
    xtest.XTestFakeButtonEvent(dpy, 1, 1, 0)
    flush()
    time.sleep(0.05)
    xtest.XTestFakeButtonEvent(dpy, 1, 0, 0)
    flush()


def combo(spec):
    parts = spec.split("+")
    mods = {"ctrl": b"Control_L", "alt": b"Alt_L", "shift": b"Shift_L"}
    mod_kcs = []
    key_name = parts[-1]
    for p in parts[:-1]:
        kc = keycode_for_keysym(x11.XStringToKeysym(mods[p.lower()]))
        mod_kcs.append(kc)
        key_event(kc, True)
    press_keysym(key_name)
    for kc in reversed(mod_kcs):
        key_event(kc, False)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "click":
        click(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "dblclick":
        dblclick(int(sys.argv[2]), int(sys.argv[3]))
    elif cmd == "scroll":
        scroll(int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    elif cmd == "move":
        xtest.XTestFakeMotionEvent(dpy, -1, int(sys.argv[2]), int(sys.argv[3]), 0)
        flush()
    elif cmd == "type":
        type_text(sys.argv[2])
    elif cmd == "key":
        spec = sys.argv[2]
        if "+" in spec:
            combo(spec)
        else:
            press_keysym(spec)
    elif cmd == "sleep":
        time.sleep(float(sys.argv[2]))
    time.sleep(0.1)
