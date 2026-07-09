"""카드뉴스 HTML → PNG 8장 (1080x1080). worksheet-studio venv의 playwright 사용."""
import pathlib
from playwright.sync_api import sync_playwright

HTML = pathlib.Path(__file__).parent / 'cardnews.html'
OUT = pathlib.Path.home() / 'Desktop' / '베이비블룸_카드뉴스'
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1200, 'height': 1200}, device_scale_factor=2)
    page.goto(HTML.as_uri())
    page.wait_for_function('document.fonts.ready.then(() => true)')
    page.wait_for_timeout(800)
    for i in range(1, 9):
        el = page.locator(f'#c{i}')
        el.screenshot(path=str(OUT / f'{i:02d}.png'))
        print(f'saved {i:02d}.png')
    browser.close()
print(f'완료: {OUT}')
