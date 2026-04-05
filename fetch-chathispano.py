#!/usr/bin/env python3
import urllib.request
import json

url = 'https://chathispano.com/'
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        content = response.read().decode('utf-8')
        
        # Show first part
        print("=== FIRST 4000 CHARS ===")
        print(content[:4000])
        
        # Find script tags
        print("\n=== SCRIPT TAGS ===")
        import re
        scripts = re.findall(r'<script[^>]*src="([^"]*)"', content)
        for script in scripts:
            print(f"SCRIPT: {script}")
        
        # Look for specific patterns
        print("\n=== KIWI/IRC REFERENCES ===")
        if 'kiwi' in content.lower():
            print("✓ Found 'kiwi' reference")
        if 'socket.io' in content.lower():
            print("✓ Found 'socket.io' reference")
        if 'sockjs' in content.lower():
            print("✓ Found 'sockjs' reference")
        if 'websocket' in content.lower():
            print("✓ Found 'websocket' reference")
        if 'control start' in content.lower():
            print("✓ Found 'control start' reference")
        
        # Look for inline scripts with interesting content
        if_scripts = re.findall(r'<script[^>]*>([^<]*)</script>', content)
        print(f"\n=== INLINE SCRIPTS ({len(if_scripts)}) ===")
        for i, script in enumerate(if_scripts[:3]):
            if len(script) > 100:
                print(f"Script #{i+1}: {script[:200]}...")
            else:
                print(f"Script #{i+1}: {script}")

except Exception as e:
    print(f"Error: {e}")
