#!/usr/bin/env python3
"""
RouteRush Screenshot Capture Script
Launches Pebble emulator for all platforms and captures train/bus page screenshots
"""

import subprocess
import time
import os
import sys
from pathlib import Path

PLATFORMS = ["aplite", "basalt", "chalk", "diorite", "emery", "flint", "gabbro"]
SCRIPT_DIR = Path(__file__).parent.absolute()
SCREENSHOTS_DIR = SCRIPT_DIR / "screenshots"
BUILD_DIR = SCRIPT_DIR / "build"
APP_PATH = BUILD_DIR / "RouteRush.pbw"

def run_command(cmd, check=True, capture_output=False):
    """Run a shell command and return result"""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            check=check,
            capture_output=capture_output,
            text=True,
            timeout=30
        )
        return result
    except subprocess.TimeoutExpired:
        print(f"    ⚠️  Command timed out: {cmd}")
        return None
    except Exception as e:
        print(f"    ❌ Error running command: {e}")
        return None

def ensure_built():
    """Ensure app is built"""
    if not APP_PATH.exists():
        print("📦 App not built. Building now...")
        result = run_command(f"cd {SCRIPT_DIR} && pebble build", capture_output=True)
        if result and result.returncode == 0:
            print("✓ Build successful")
            return True
        else:
            print("❌ Build failed")
            return False
    print("✓ App already built")
    return True

def install_app_to_emulator(platform):
    """Install app to emulator for given platform"""
    cmd = f"cd {SCRIPT_DIR} && pebble install --emulator {platform} {APP_PATH}"
    print(f"  Installing app to {platform} emulator...")
    result = run_command(cmd, capture_output=True)
    
    if result and result.returncode == 0:
        print(f"    ✓ Installation successful")
        return True
    else:
        print(f"    ❌ Installation failed")
        if result and result.stderr:
            print(f"    Error: {result.stderr[:200]}")
        return False

def take_screenshot(platform, page_name):
    """Take screenshot for given platform and page"""
    output_file = SCREENSHOTS_DIR / f"{platform}_{page_name}.png"
    cmd = f"pebble screenshot --emulator {platform} {output_file}"
    
    result = run_command(cmd, capture_output=True)
    if result and result.returncode == 0:
        print(f"    ✓ Screenshot saved: {output_file.name}")
        return True
    else:
        print(f"    ⚠️  Screenshot failed")
        return False

def send_button_event(platform, button):
    """Send button event to emulator (UP, DOWN, or SELECT)"""
    # Try using pebble eval if available, otherwise try xdotool
    buttons = {"UP": "up", "DOWN": "down", "SELECT": "select"}
    button_name = buttons.get(button, button.lower())
    
    cmd = f"pebble emu-button click {button_name} --emulator {platform} 2>/dev/null"
    result = run_command(cmd, check=False, capture_output=True)
    
    if result and result.returncode == 0:
        return True
    
    print(f"    Note: Button simulation may not be available on this system")
    return False

def main():
    print("📸 RouteRush Screenshot Capture Script")
    print("=" * 40)
    print()
    
    # Create screenshots directory
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Check if app is built
    if not ensure_built():
        sys.exit(1)
    
    print()
    
    # Process each platform
    for platform in PLATFORMS:
        print(f"🚀 Platform: {platform}")
        print("─" * 40)
        
        # Install app
        if not install_app_to_emulator(platform):
            print(f"  ⏭️  Skipping {platform} due to installation failure")
            continue
        
        # Wait for emulator to load
        print("  ⏱️  Waiting for emulator to initialize...")
        time.sleep(5)
        
        # Take train page screenshot (initial page)
        print("  📷 Capturing train page...")
        if not take_screenshot(platform, "trains"):
            print(f"  ⏭️  Skipping bus page for {platform}")
            continue
        
        # Try to switch to bus page
        print("  🔄 Attempting to switch to bus page...")
        if send_button_event(platform, "SELECT"):
            print("    ✓ SELECT button sent")
        
        # Wait for page transition
        time.sleep(5)
        
        # Take bus page screenshot
        print("  📷 Capturing bus page...")
        take_screenshot(platform, "buses")
        
        print()
    
    print("✅ Screenshot capture complete!")
    print(f"   Screenshots saved to: {SCREENSHOTS_DIR}")
    print()
    print("📁 Files created:")
    
    if SCREENSHOTS_DIR.exists():
        files = sorted(SCREENSHOTS_DIR.glob("*.png"))
        for f in files:
            size = f.stat().st_size
            size_str = f"{size/1024:.1f}KB" if size > 1024 else f"{size}B"
            print(f"   {f.name} ({size_str})")
    else:
        print("   (No screenshots found)")

if __name__ == "__main__":
    main()
