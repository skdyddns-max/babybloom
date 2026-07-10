"""쇼츠 세로 배경 렌더 (1080x1920) — 컷당 A/B 앵글 12장."""
import pathlib
from playwright.sync_api import sync_playwright

D = pathlib.Path(__file__).parent
IDS = [f'bg{i}' for i in range(1, 7)] + [f'bg{i}b' for i in range(1, 7)]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1080, 'height': 1920})
    page.goto((D / 'bg.html').as_uri())
    page.wait_for_function('document.fonts.ready.then(() => true)')
    page.wait_for_timeout(500)
    for bid in IDS:
        page.locator(f'#{bid}').screenshot(path=str(D / f'{bid}.png'))
        print(f'{bid}.png')
    browser.close()
