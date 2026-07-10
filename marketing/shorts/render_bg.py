"""쇼츠 세로 배경 6장 렌더 (1080x1920)."""
import pathlib
from playwright.sync_api import sync_playwright

D = pathlib.Path(__file__).parent

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1080, 'height': 1920})
    page.goto((D / 'bg.html').as_uri())
    page.wait_for_function('document.fonts.ready.then(() => true)')
    page.wait_for_timeout(500)
    for i in range(1, 7):
        page.locator(f'#bg{i}').screenshot(path=str(D / f'bg{i}.png'))
        print(f'bg{i}.png')
    browser.close()
