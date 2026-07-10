#!/usr/bin/env python3
"""
카라오케 자막 쇼츠 — 말하는 문장을 자막으로, 단어가 '실제 발화 시각'에 하이라이트.
  사용: python3 make_karaoke_shorts.py <run_assets_dir> [n_cuts]
  ~/.talkbloom-secrets 의 ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID 사용.
  컷별: v3 with-timestamps 로 음성+글자별 타임스탬프 획득 → 단어 타이밍 계산 →
        말하는 구어체 문장을 짧은 청크로 나눠 화면에 띄우고, 지금 말하는 단어를 하이라이트.
        배경은 매끄러운 켄번스(줌인/줌아웃 교대), 은은한 BGM.
  결과: 5_유튜브쇼츠/유튜브쇼츠_카라오케.mp4 + 4_틱톡/틱톡영상_카라오케.mp4  (미리보기는 …_미리보기.mp4)
"""
import sys, os, re, json, base64, subprocess, shutil, importlib.util

TPL = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
_FD = os.path.expanduser("~/Library/Fonts")
FPS = 30
LEAD = 0.18          # 음성 시작 전 리드(초)
TAIL = 0.40          # 마지막 단어 뒤 여유
MAXW = 4             # 한 청크(화면) 최대 단어 수
MODEL = "eleven_v3"

FONT = ("<style>"
        f"@font-face{{font-family:'P';font-weight:700;src:url('file://{_FD}/Pretendard-Bold.ttf')}}"
        f"@font-face{{font-family:'P';font-weight:800;src:url('file://{_FD}/Pretendard-Bold.ttf')}}"
        f"@font-face{{font-family:'P';font-weight:900;src:url('file://{_FD}/Pretendard-Bold.ttf')}}"
        "</style>")

CAP_CSS = """
*{margin:0;box-sizing:border-box}html,body{width:1080px;height:1920px;background:transparent;font-family:'P',sans-serif}
.scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(255,247,235,0) 40%,rgba(255,247,235,.55) 58%,rgba(255,244,228,.92) 100%)}
.brand{position:absolute;top:54px;left:54px;display:flex;align-items:center;gap:14px}
.brand img{width:70px;height:70px;border-radius:17px;box-shadow:0 6px 18px rgba(0,0,0,.18)}
.brand .bn{font-weight:800;font-size:40px;color:#8A6237;text-shadow:0 2px 10px rgba(255,255,255,.5)}
.cap{position:absolute;left:80px;right:80px;bottom:560px;display:flex;flex-wrap:wrap;gap:8px 22px;
     align-content:flex-end;justify-content:center}
.w{display:inline-block;font-weight:900;font-size:116px;line-height:1.12;letter-spacing:-1px;
   color:#3A2C1C;opacity:.5;transform:scale(.97);transform-origin:center bottom;
   text-shadow:0 3px 18px rgba(255,255,255,.75),0 1px 2px rgba(255,255,255,.6)}
.w.said{opacity:1;transform:none}
.w.now{opacity:1;color:#E8590C;transform:scale(1.08);text-shadow:0 4px 20px rgba(255,255,255,.8)}
.cta{position:absolute;left:80px;bottom:410px;background:#F2845C;color:#fff;font-weight:800;
     font-size:46px;padding:20px 40px;border-radius:999px;box-shadow:0 8px 22px rgba(242,132,92,.5)}
.dots{position:absolute;left:80px;bottom:320px;display:flex;gap:14px}
.dot{width:20px;height:20px;border-radius:50%;background:rgba(150,110,70,.32)}
.dot.on{background:#E8590C;width:52px;border-radius:10px}
"""


def load(run_dir):
    p = os.path.join(run_dir, "cardnews_content.py")
    spec = importlib.util.spec_from_file_location("cardnews_content", p)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m.CARDNEWS


def secrets():
    d = {}
    sp = os.path.expanduser("~/.talkbloom-secrets")
    if os.path.exists(sp):
        for line in open(sp):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1); d[k] = v
    return d


def dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", path], capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def tts_ts(text, key, vid, mp3):
    """v3 with-timestamps → mp3 저장, 단어 리스트 [{'t':start,'e':end,'w':text}] 반환.
       같은 텍스트로 이미 생성된 mp3+json이 있으면 재사용(API 재호출 방지)."""
    payload = json.dumps({"text": text, "model_id": MODEL,
                          "voice_settings": {"stability": 0.5, "similarity_boost": 0.9}})
    js = mp3 + ".ts.json"
    cache_tag = mp3 + ".txt"
    if os.path.exists(mp3) and os.path.exists(js) and os.path.exists(cache_tag) \
            and open(cache_tag, encoding="utf-8").read() == text:
        d = json.load(open(js))
    else:
        d = None
    if d is None:
        r = _tts_call(payload, key, vid, js)
        d = json.load(open(js))
        open(mp3, "wb").write(base64.b64decode(d["audio_base64"]))
        open(cache_tag, "w", encoding="utf-8").write(text)
    a = d["alignment"]
    chars = a["characters"]; st = a["character_start_times_seconds"]; en = a["character_end_times_seconds"]
    words, cur, ws, we = [], "", None, None
    for ch, s, e in zip(chars, st, en):
        if ch.isspace():
            if cur:
                words.append({"w": cur, "t": ws, "e": we}); cur = ""
        else:
            if not cur:
                ws = s
            cur += ch; we = e
    if cur:
        words.append({"w": cur, "t": ws, "e": we})
    return words


def _tts_call(payload, key, vid, js):
    r = subprocess.run(["curl", "-s", "-o", js, "-w", "%{http_code}",
                        "-X", "POST", f"https://api.elevenlabs.io/v1/text-to-speech/{vid}/with-timestamps",
                        "-H", f"xi-api-key: {key}", "-H", "Content-Type: application/json",
                        "-d", payload], capture_output=True, text=True)
    if r.stdout.strip() != "200":
        sys.exit(f"[karaoke] 음성 실패 HTTP {r.stdout.strip()}: {open(js).read()[:200]}")
    return r


def chunk_words(words):
    """단어들을 짧은 청크로. 문장부호(.!?) 뒤 또는 MAXW 도달 시 분할."""
    chunks, cur = [], []
    for i, wd in enumerate(words):
        cur.append(i)
        ends_sent = any(ch in ".!?…" for ch in wd["w"][-2:])  # 끝 따옴표 뒤 문장부호도 인식
        if len(cur) >= MAXW or ends_sent:
            chunks.append(cur); cur = []
    if cur:
        chunks.append(cur)
    idx2chunk = {}
    for ci, ch in enumerate(chunks):
        for wi in ch:
            idx2chunk[wi] = ci
    return chunks, idx2chunk


def state_html(logo_uri, dots, cta_html, chunk_words_list, now_local):
    spans = []
    for j, wtext in enumerate(chunk_words_list):
        cls = "w now" if j == now_local else ("w said" if j < now_local else "w")
        spans.append(f'<span class="{cls}">{wtext}</span>')
    brand = (f'<div class="brand"><img src="{logo_uri}"><span class="bn">용디쌤 🌷</span></div>'
             if logo_uri else '<div class="brand"><span class="bn">용디쌤 🌷</span></div>')
    return (f"<!doctype html><html lang=ko><head><meta charset=utf-8>{FONT}<style>{CAP_CSS}</style></head>"
            f'<body><div class="scrim"></div>{brand}'
            f'<div class="cap">{"".join(spans)}</div>{cta_html}'
            f'<div class="dots">{dots}</div></body></html>')


def main(run_dir, n_cuts=None):
    if not shutil.which("ffmpeg"):
        sys.exit("[karaoke] ffmpeg 필요")
    run_dir = os.path.abspath(run_dir)
    c = load(run_dir)
    shorts = c.get("shorts", [])
    if not shorts:
        sys.exit("[karaoke] shorts 없음")
    preview = n_cuts is not None
    if preview:
        shorts = shorts[:int(n_cuts)]

    sec = secrets()
    KEY = sec.get("ELEVENLABS_API_KEY"); VID = sec.get("ELEVENLABS_VOICE_ID")
    if not KEY or not VID:
        sys.exit("[karaoke] ~/.talkbloom-secrets 에 KEY/VOICE_ID 필요")

    dest = os.path.expanduser("~/Desktop/베이비블룸_카드뉴스")
    os.makedirs(dest, exist_ok=True)
    img_map = {}
    for slot, spec in c.get("illustrations", {}).items():
        p = os.path.join(run_dir, spec.get("file", ""))
        if os.path.exists(p):
            img_map[slot] = p
    # 쇼츠 전용 세로 배경(있으면 우선): 컷 순서대로 sbg1..N
    sbg_map = {}
    for idx, spec in enumerate(c.get("shorts_bg", []), start=1):
        p = os.path.join(run_dir, spec.get("file", ""))
        if os.path.exists(p):
            sbg_map[idx] = p
    # 컷 두 번째 앵글(중간 화면 전환용)
    sbg2_map = {}
    for idx, spec in enumerate(c.get("shorts_bg2", []), start=1):
        p = os.path.join(run_dir, spec.get("file", ""))
        if os.path.exists(p):
            sbg2_map[idx] = p
    logo_path = os.path.join(TPL, "logo.png")
    logo_uri = ("data:image/png;base64," + base64.b64encode(open(logo_path, "rb").read()).decode()
                if os.path.exists(logo_path) else "")

    total_all = len(c.get("shorts", []))
    tmp = os.path.join(run_dir, "pub_s", "_kar"); os.makedirs(tmp, exist_ok=True)  # TTS 캐시 유지 위해 삭제 안 함

    # BGM (실패해도 무음)
    bgm = os.path.join(tmp, "bgm.mp3")
    try:
        rb = subprocess.run(["curl", "-s", "-o", bgm, "-w", "%{http_code}", "-X", "POST",
                             "https://api.elevenlabs.io/v1/sound-generation",
                             "-H", f"xi-api-key: {KEY}", "-H", "Content-Type: application/json",
                             "-d", json.dumps({"text": "soft warm gentle ambient background music, calm "
                                               "hopeful piano and soft pads, tender parenting mood, no drums, "
                                               "seamless", "duration_seconds": 22})],
                            capture_output=True, text=True)
        if rb.stdout.strip() != "200" or dur(bgm) < 1:
            bgm = None
    except Exception:
        bgm = None
    print("  BGM:", "생성됨" if bgm else "없음")

    v_clips, a_clips = [], []
    for i, cut in enumerate(shorts, 1):
        narr = cut.get("narration") or re.sub(r"<[^>]+>", "", cut["text"]).replace("<br>", " ")
        mp3 = os.path.join(tmp, f"v{i}.mp3")
        words = tts_ts(narr, KEY, VID, mp3)
        adur = dur(mp3)
        cut_dur = round(LEAD + adur + TAIL, 3)
        chunks, idx2chunk = chunk_words(words)

        # 컷 오디오 (리드 침묵 + 음성 + 뒤 침묵)
        wav = os.path.join(tmp, f"a{i}.wav")
        subprocess.run(["ffmpeg", "-y", "-i", mp3,
                        "-af", f"adelay={int(LEAD*1000)}|{int(LEAD*1000)},apad",
                        "-t", f"{cut_dur}", "-ar", "44100", "-ac", "2", wav],
                       check=True, capture_output=True)
        a_clips.append(wav)

        dots = "".join(f'<span class="dot{" on" if j == i else ""}"></span>' for j in range(1, total_all + 1))
        cta_html = f'<div class="cta">{cut["cta"]}</div>' if cut.get("cta") else ""

        # 자막: 문구(청크) 단위로 렌더 → ffmpeg 페이드로 부드럽게 등장(단어별 튐·크기변화 제거)
        states = []   # (png, t_start, t_end)
        for ci, ch in enumerate(chunks):
            wl = [words[k]["w"] for k in ch]
            html = state_html(logo_uri, dots, cta_html, wl, len(wl))  # 전부 균일 흰색
            hp = os.path.join(tmp, f"s{i}_{ci}.html"); open(hp, "w", encoding="utf-8").write(html)
            fp = os.path.join(tmp, f"s{i}_{ci}.png")
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            "--default-background-color=00000000", f"--screenshot={fp}",
                            "--window-size=1080,1920", "--force-device-scale-factor=1",
                            "--virtual-time-budget=500", f"file://{hp}"], check=True, capture_output=True)
            os.remove(hp)
            cs = LEAD + words[ch[0]]["t"]
            ce = (LEAD + words[chunks[ci + 1][0]]["t"]) if ci + 1 < len(chunks) else cut_dur
            states.append((fp, round(cs, 3), round(ce, 3)))

        # 배경: 컷당 2장 + 컷 중간 슬라이드 전환(진짜 영상 느낌). A=줌인, B=줌아웃.
        bgA = sbg_map.get(i) or img_map.get(cut.get("bg", ""), "")
        # 두 번째 앵글: 전용 이미지(sbg◯b) 우선, 없으면 다른 기존 sbg를 교차로(캐릭터 일관)
        nfb = (i % len(sbg_map) + 1) if sbg_map else i
        bgB = sbg2_map.get(i) or sbg_map.get(nfb) or bgA
        SW = round(cut_dur * 0.5, 3)          # 전환 시점(컷 중간)
        TR = 0.35                              # 전환 길이
        framesA = max(int(round((SW + TR) * FPS)), 2); NA = max(framesA - 1, 1)
        framesB = max(int(round((cut_dur - SW) * FPS)), 2); NB = max(framesB - 1, 1)
        pA = f"(1-pow(1-on/{NA},2))"; pB = f"(1-pow(1-on/{NB},2))"
        zA = f"1.0+0.10*{pA}"; zB = f"1.10-0.10*{pB}"
        trans = "slideleft" if i % 2 == 1 else "slideright"
        inputs = ["-y", "-loop", "1", "-i", bgA, "-loop", "1", "-i", bgB]
        for st in states:
            inputs += ["-loop", "1", "-i", st[0]]
        cov = "scale=3240:5760:force_original_aspect_ratio=increase,crop=3240:5760"
        zp = f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps={FPS}"
        fc = (f"[0:v]{cov},zoompan=z='{zA}':d={framesA}:{zp},format=yuv420p[a];"
              f"[1:v]{cov},zoompan=z='{zB}':d={framesB}:{zp},format=yuv420p[b];"
              f"[a][b]xfade=transition={trans}:duration={TR}:offset={SW}[bg];")
        prev = "bg"
        for k, st in enumerate(states, start=2):
            cs, ce = st[1], st[2]
            # 문구를 부드럽게 페이드 인 (알파 페이드) → 매끄러운 등장
            fc += (f"[{k}:v]format=yuva420p,fade=t=in:st={cs}:d=0.28:alpha=1[cf{k}];"
                   f"[{prev}][cf{k}]overlay=0:0:enable='between(t,{cs},{ce})'[o{k}];")
            prev = f"o{k}"
        clip = os.path.join(tmp, f"clip{i}.mp4")
        subprocess.run(["ffmpeg", *inputs, "-filter_complex", fc.rstrip(";"),
                        "-map", f"[{prev}]", "-t", f"{cut_dur}", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-r", str(FPS), clip], check=True, capture_output=True)
        v_clips.append(clip)
        print(f"  컷 {i}/{len(shorts)}  {adur:.1f}s · 단어 {len(words)}개 · 청크 {len(chunks)}  「{narr[:18]}…」")

    # concat + BGM 믹스 + mux
    vlist = os.path.join(tmp, "v.txt"); open(vlist, "w").write("".join(f"file '{x}'\n" for x in v_clips))
    vcat = os.path.join(tmp, "v.mp4")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", vlist,
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", vcat], check=True, capture_output=True)
    alist = os.path.join(tmp, "a.txt"); open(alist, "w").write("".join(f"file '{x}'\n" for x in a_clips))
    acat = os.path.join(tmp, "a.wav")
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", alist, "-c", "copy", acat],
                   check=True, capture_output=True)
    vdur = dur(acat)
    if bgm:
        aud = os.path.join(tmp, "mix.wav")
        subprocess.run(["ffmpeg", "-y", "-i", acat, "-stream_loop", "-1", "-i", bgm,
                        "-filter_complex",
                        f"[1:a]volume=0.10,afade=t=in:st=0:d=1.2,"
                        f"afade=t=out:st={max(0.1, vdur-1.6):.2f}:d=1.6[bg];"
                        f"[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]",
                        "-map", "[a]", "-t", f"{vdur}", "-ar", "44100", "-ac", "2", aud],
                       check=True, capture_output=True)
    else:
        aud = acat
    final = os.path.join(tmp, "final.mp4")
    subprocess.run(["ffmpeg", "-y", "-i", vcat, "-i", aud, "-c:v", "copy", "-c:a", "aac",
                    "-b:a", "192k", "-shortest", final], check=True, capture_output=True)

    tot = dur(final)
    if preview:
        out = os.path.join(dest, "쇼츠_미리보기.mp4"); shutil.copy(final, out)
        print(f"\n[미리보기] {len(shorts)}컷 {tot:.1f}초 → {out}")
    else:
        out = os.path.join(dest, "베이비블룸_쇼츠.mp4"); shutil.copy(final, out)
        print(f"\n카라오케 자막 영상 완성 ({len(shorts)}컷, {tot:.1f}초) → {out}")
    # tmp 유지: v*.mp3(+.ts.json)가 TTS 캐시 역할


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("사용: python3 make_karaoke_shorts.py <run_assets_dir> [n_cuts]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
