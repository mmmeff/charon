import { useEffect, useRef } from "react";

/**
 * The marketing site's ASCII Charon, ported: a WebGL2 two-pass shader —
 * (1) a tiny moon scene rendered at one texel per character cell, then
 * (2) a composite pass that maps cell luminance onto a glyph atlas.
 * Slow axial drift, dusty red polar cap, equatorial chasm, ember glow,
 * twinkling per-cell stars, and a whisper of pointer parallax.
 * Used on empty / idle states (the flow field covers loading states).
 * Falls back to nothing if WebGL2 is unavailable.
 */

const VERT = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID<<1 & 2), (gl_VertexID & 2));
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

// app charcoal (--bg #0e0d0a) so the canvas blends into the page
const SCENE_FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uCells;
uniform float uTime;
uniform float uAspect;
uniform vec2 uMouse;

float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(17.0,9.2); a*=0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uCells;
  vec3 col = vec3(0.0);

  // stars: sparse, per-cell twinkle
  vec2 cell = floor(uv*uCells);
  float s = hash(cell*1.37);
  float tw = step(0.992, s) * (0.35 + 0.65*pow(0.5+0.5*sin(uTime*1.7 + s*60.0), 2.0));
  col += vec3(0.91,0.89,0.83) * tw * 0.65;

  // drifting embers rising on the left
  vec2 ep = uv*vec2(uAspect,1.0);
  float em = noise(vec2(ep.x*14.0, ep.y*3.0 - uTime*0.22));
  float ember = smoothstep(0.965, 1.0, em) * smoothstep(0.85, 0.2, uv.x) * 0.7;
  col += vec3(1.0,0.31,0.0) * ember;

  // the moon — smaller and tucked top-right on narrow canvases
  float portrait = smoothstep(1.15, 0.7, uAspect);
  vec2 c = vec2(mix(0.73, 0.86, portrait) + uMouse.x*0.012,
                mix(0.46, 0.84, portrait) + uMouse.y*0.012);
  vec2 p = uv - c; p.x *= uAspect;
  float r = 0.40 * mix(1.0, 0.5, portrait);
  float d = length(p);

  if(d < r){
    vec2 q = p / r;
    float z = sqrt(max(0.0, 1.0 - dot(q,q)));
    vec3 n = vec3(q, z);
    float lon = atan(q.x, z) + uTime*0.045;
    float lat = asin(clamp(q.y, -1.0, 1.0));
    vec2 sp = vec2(lon*1.4, lat*1.6);

    float tex = fbm(sp*2.6 + 7.0);
    vec3 albedo = mix(vec3(0.62,0.59,0.53), vec3(0.84,0.81,0.73), tex);

    // dusty red polar cap
    float capEdge = 0.62 + 0.20*fbm(vec2(lon*2.2, 3.0));
    float cap = smoothstep(capEdge-0.10, capEdge+0.14, lat);
    albedo = mix(albedo, vec3(0.61,0.27,0.12), cap*0.92);

    // canyon band
    float chY = lat + 0.16 - 0.12*noise(vec2(lon*1.8, 9.0));
    float ch = smoothstep(0.045, 0.0, abs(chY));
    albedo = mix(albedo, vec3(0.30,0.28,0.24), ch*0.65);

    // craters
    float cr = smoothstep(0.60, 0.78, fbm(sp*5.5 + 13.0));
    albedo *= 1.0 - 0.28*cr;

    vec3 L = normalize(vec3(-0.55, 0.38, 0.72));
    float diff = clamp(dot(n,L), 0.0, 1.0);
    col = albedo * (0.05 + 1.05*pow(diff, 1.15));

    // warm rim on the lit limb
    float rim = pow(1.0 - z, 2.6);
    col += vec3(1.0,0.31,0.0) * rim * 0.4 * smoothstep(0.0,0.3,diff);
  } else {
    float glow = exp(-(d - r)*8.0);
    col += vec3(1.0,0.31,0.0) * glow * 0.22;
  }
  o = vec4(col, 1.0);
}`;

const COMP_FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uScene;
uniform sampler2D uGlyphs;
uniform vec2 uCells;
uniform vec2 uCellPx;
uniform float uGlyphN;
const vec3 BG = vec3(0.055, 0.051, 0.039); /* --bg charcoal */
void main(){
  vec2 cell = floor(gl_FragCoord.xy / uCellPx);
  vec2 cuv = (cell + 0.5) / uCells;
  vec3 c = texture(uScene, cuv).rgb;
  float luma = clamp(dot(c, vec3(0.299,0.587,0.114)), 0.0, 1.0);
  float gi = floor(min(luma, 0.999) * uGlyphN);
  vec2 inCell = vec2(
    fract(gl_FragCoord.x / uCellPx.x),
    1.0 - fract(gl_FragCoord.y / uCellPx.y)
  );
  vec2 guv = vec2((gi + inCell.x) / uGlyphN, inCell.y);
  float a = texture(uGlyphs, guv).a;
  vec3 tint = c / max(luma, 0.02);
  vec3 col = tint * min(1.0, 0.35 + luma*1.1);
  o = vec4(mix(BG, col, a), 1.0);
}`;

const RAMP = " .,:;i+*xeo#%@";

function makeGlyphAtlas(cellW: number, cellH: number): HTMLCanvasElement {
  const n = RAMP.length;
  const cv = document.createElement("canvas");
  cv.width = cellW * n;
  cv.height = cellH;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#fff";
  g.font = `${Math.floor(cellH * 0.82)}px ${getComputedStyle(document.body).fontFamily}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < n; i++) g.fillText(RAMP[i], i * cellW + cellW / 2, cellH / 2 + 1);
  return cv;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "");
  return s;
}

function program(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "");
  return p;
}


/**
 * `fill` renders the canvas absolutely positioned to cover the nearest
 * positioned ancestor — the marketing-site hero treatment, used as a
 * full-bleed animated backdrop behind empty states and the draft form.
 */
export function AsciiMoon({ height = 200, fill = false }: { height?: number; fill?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    } catch {
      /* fall through */
    }
    if (!gl) return; // graceful: charcoal background remains

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const CW = Math.round(8 * dpr);
    const CH = Math.round(15 * dpr);

    let scene: WebGLProgram, comp: WebGLProgram;
    try {
      scene = program(gl, SCENE_FRAG);
      comp = program(gl, COMP_FRAG);
    } catch (e) {
      console.warn("ascii moon disabled:", e);
      return;
    }
    gl.bindVertexArray(gl.createVertexArray());

    const glyphTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glyphTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeGlyphAtlas(CW, CH));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const sceneTex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    let cols = 0;
    let rows = 0;

    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width === w && canvas.height === h && cols) return;
      canvas.width = w;
      canvas.height = h;
      cols = Math.max(2, Math.ceil(w / CW));
      rows = Math.max(2, Math.ceil(h / CH));
      gl!.bindTexture(gl!.TEXTURE_2D, sceneTex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, cols, rows, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    };

    const u = (p: WebGLProgram, name: string) => gl!.getUniformLocation(p, name);
    let mouse = [0, 0];
    const onPointer = (e: PointerEvent) => {
      mouse = [(e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)];
    };
    addEventListener("pointermove", onPointer, { passive: true });

    let visible = true;
    let raf = 0;
    let disposed = false;
    const t0 = performance.now();

    const frame = () => {
      raf = 0;
      if (disposed || document.hidden || !visible) return;
      resize();
      const t = (performance.now() - t0) / 1000;

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.viewport(0, 0, cols, rows);
      gl!.useProgram(scene);
      gl!.uniform2f(u(scene, "uCells"), cols, rows);
      gl!.uniform1f(u(scene, "uTime"), t);
      gl!.uniform1f(u(scene, "uAspect"), canvas.width / canvas.height);
      gl!.uniform2f(u(scene, "uMouse"), mouse[0], mouse[1]);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.useProgram(comp);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, sceneTex);
      gl!.uniform1i(u(comp, "uScene"), 0);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, glyphTex);
      gl!.uniform1i(u(comp, "uGlyphs"), 1);
      gl!.uniform2f(u(comp, "uCells"), cols, rows);
      gl!.uniform2f(u(comp, "uCellPx"), CW, CH);
      gl!.uniform1f(u(comp, "uGlyphN"), RAMP.length);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);

      raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);
    const onVis = () => {
      if (!document.hidden && visible && !raf) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      removeEventListener("pointermove", onPointer);
      // NOTE: do NOT call WEBGL_lose_context.loseContext() here. getContext()
      // is idempotent per-canvas — it returns the same context object on the
      // next call. Under React 18 <StrictMode> (dev), effects run twice: the
      // first cleanup would permanently lose the context, so the second mount
      // gets back that same dead context and createShader() returns null.
      // Let GC reclaim it when the canvas leaves the DOM.
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={
        fill
          ? { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }
          : { width: "100%", height, display: "block" }
      }
      aria-hidden
    />
  );
}

