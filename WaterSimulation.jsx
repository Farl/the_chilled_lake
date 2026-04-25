import { jsxDEV } from "react/jsx-dev-runtime";
import React, { useRef, useEffect } from "react";
import * as THREE from "three";
const WaterSimulation = ({ config }) => {
  const containerRef = useRef(null);
  const rainSoundsRef = useRef([]);
  const userSoundsRef = useRef([]);
  const lastRainSoundTimeRef = useRef(0);
  const lastUserSoundTimeRef = useRef(0);
  const mouseRef = useRef(new THREE.Vector2(-1, -1));
  const prevMouseRef = useRef(new THREE.Vector2(-1, -1));
  const isMouseDown = useRef(false);
  const configRef = useRef(config);
  const rainIntensityStateRef = useRef({
    current: config.rainIntensity,
    target: config.rainIntensity,
    lastUpdate: 0
  });
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const rendererRef = useRef(null);
  const targetsRef = useRef(null);
  const simMaterialRef = useRef(null);
  const renderMaterialRef = useRef(null);
  const floorTexARef = useRef(null);
  const floorTexBRef = useRef(null);
  const crossfadeStateRef = useRef({
    active: false,
    startTime: 0,
    duration: 2e3
    // ms
  });
  const carouselStateRef = useRef({
    textures: [],
    currentIndex: 0,
    lastSwitchTime: 0,
    switchInterval: 8e3
  });
  const fpsStateRef = useRef({
    lastTime: 0,
    frameCount: 0,
    lastFpsCheck: 0,
    avgFps: 60,
    scale: 1,
    lastAdjust: 0
  });
  useEffect(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioCtxRef = { current: null };
    const convolverRef = { current: null };
    const masterGainRef = { current: null };
    const buffersRef = { current: { rain: null, user: null } };
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;
      const masterGain = ctx.createGain();
      masterGain.gain.value = 3;
      masterGainRef.current = masterGain;
      masterGain.connect(ctx.destination);
      const convolver = ctx.createConvolver();
      convolverRef.current = convolver;
      convolver.connect(masterGain);
      const createReverbImpulse = (context, duration = 0.6, decay = 0.5) => {
        const rate = context.sampleRate;
        const length = rate * duration;
        const impulse = context.createBuffer(2, length, rate);
        for (let c = 0; c < 2; c++) {
          const channel = impulse.getChannelData(c);
          for (let i = 0; i < length; i++) {
            const t = i / length;
            channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (t < 0.03 ? 0.7 : 1);
          }
        }
        return impulse;
      };
      convolver.buffer = createReverbImpulse(ctx);
      const loadBuffer = async (src, key) => {
        try {
          const res = await fetch(src);
          const arrayBuffer = await res.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          buffersRef.current[key] = audioBuffer;
        } catch (e) {
          console.warn("Failed to load sfx buffer:", src, e);
        }
      };
      loadBuffer("/raindrop_soft.mp3", "rain");
      loadBuffer("/splash_user.mp3", "user");
    }
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    const basePixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(basePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    fpsStateRef.current = {
      lastTime: 0,
      frameCount: 0,
      lastFpsCheck: 0,
      avgFps: 60,
      scale: 1,
      lastAdjust: performance.now(),
      basePixelRatio
    };
    const SIM_RES_BASE = 512;
    const simResX = SIM_RES_BASE;
    const simResY = Math.round(SIM_RES_BASE / aspect);
    const createTargets = (w, h) => {
      const options = {
        format: THREE.RGBAFormat,
        type: THREE.FloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        stencilBuffer: false,
        depthBuffer: false
      };
      return {
        read: new THREE.WebGLRenderTarget(w, h, options),
        write: new THREE.WebGLRenderTarget(w, h, options),
        old: new THREE.WebGLRenderTarget(w, h, options)
      };
    };
    targetsRef.current = createTargets(simResX, simResY);
    const simMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCurrent: { value: null },
        uPrev: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / simResX, 1 / simResY) },
        uDamping: { value: config.damping },
        uDropPos: { value: new THREE.Vector2(-1, -1) },
        uDropRadius: { value: config.dropRadius },
        uDropStrength: { value: config.dropStrength }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uCurrent;
        uniform sampler2D uPrev;
        uniform vec2 uTexelSize;
        uniform float uDamping;
        uniform vec2 uDropPos;
        uniform float uDropRadius;
        uniform float uDropStrength;
        varying vec2 vUv;

        void main() {
          float current = texture2D(uCurrent, vUv).r;
          float prev = texture2D(uPrev, vUv).r;

          float top = texture2D(uCurrent, vUv + vec2(0.0, uTexelSize.y)).r;
          float bottom = texture2D(uCurrent, vUv - vec2(0.0, uTexelSize.y)).r;
          float left = texture2D(uCurrent, vUv - vec2(uTexelSize.x, 0.0)).r;
          float right = texture2D(uCurrent, vUv + vec2(uTexelSize.x, 0.0)).r;

          float newHeight = (top + bottom + left + right) * 0.5 - prev;
          newHeight *= uDamping;

          float dist = distance(vUv, uDropPos);
          if (uDropPos.x >= 0.0) {
            newHeight += smoothstep(uDropRadius, 0.0, dist) * uDropStrength;
          }

          gl_FragColor = vec4(newHeight, 0.0, 0.0, 1.0);
        }
      `
    });
    simMaterialRef.current = simMaterial;
    const textureLoader = new THREE.TextureLoader();
    const texturePaths = [
      "./lake_bottom.png",
      "./lake_bottom_2.png",
      "./lake_bottom_3.png",
      "./lake_bottom_4.png",
      "./lake_bottom_5.png"
    ];
    const floorTex = textureLoader.load(texturePaths[0]);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTexARef.current = floorTex;
    floorTexBRef.current = floorTex;
    carouselStateRef.current = {
      textures: [floorTex],
      currentIndex: 0,
      lastSwitchTime: performance.now(),
      switchInterval: 8e3
    };
    texturePaths.slice(1).forEach((path) => {
      textureLoader.load(
        path,
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          carouselStateRef.current.textures.push(tex);
        },
        void 0,
        (err) => {
          console.warn("Failed to load carousel texture:", path, err);
        }
      );
    });
    const renderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uWaterHeight: { value: null },
        uFloorTexA: { value: floorTex },
        uFloorTexB: { value: floorTex },
        uMixFactor: { value: 0 },
        uTexelSize: { value: new THREE.Vector2(1 / simResX, 1 / simResY) },
        uRefractionScale: { value: config.refractionScale },
        uReflectionColor: { value: new THREE.Color(8965375) },
        uReflectionStrength: { value: config.reflectionStrength },
        uTime: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uWaterHeight;
        uniform sampler2D uFloorTexA;
        uniform sampler2D uFloorTexB;
        uniform float uMixFactor;
        uniform vec2 uTexelSize;
        uniform float uRefractionScale;
        uniform vec3 uReflectionColor;
        uniform float uReflectionStrength;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          float h = texture2D(uWaterHeight, vUv).r;
          float hL = texture2D(uWaterHeight, vUv - vec2(uTexelSize.x, 0.0)).r;
          float hR = texture2D(uWaterHeight, vUv + vec2(uTexelSize.x, 0.0)).r;
          float hT = texture2D(uWaterHeight, vUv + vec2(0.0, uTexelSize.y)).r;
          float hB = texture2D(uWaterHeight, vUv - vec2(0.0, uTexelSize.y)).r;

          vec3 normal = normalize(vec3(hL - hR, hB - hT, 0.1));

          // Refracted lookup into the lake-bottom textures
          vec2 refractedUv = vUv + normal.xy * uRefractionScale;
          vec3 floorColorA = texture2D(uFloorTexA, refractedUv).rgb;
          vec3 floorColorB = texture2D(uFloorTexB, refractedUv).rgb;
          vec3 floorColor = mix(floorColorA, floorColorB, clamp(uMixFactor, 0.0, 1.0));

          // Fresnel-style reflection factor based on view angle
          vec3 viewDir = normalize(vec3(0.0, 0.0, 1.0));
          float ndv = clamp(dot(normal, viewDir), 0.0, 1.0);
          float fresnel = pow(1.0 - ndv, 2.5);

          // Use a grayscale version of the floor as reflection tint to avoid color shifting
          float luminance = dot(floorColor, vec3(0.299, 0.587, 0.114));
          vec3 gray = vec3(luminance);
          vec3 reflection = mix(floorColor, gray, 0.8);

          // Blend between seeing the bottom and seeing the reflection
          vec3 finalColor = mix(floorColor, reflection, fresnel * uReflectionStrength);

          // Specular highlight for sparkle
          vec3 lightDir = normalize(vec3(0.3, 0.4, 1.0));
          float spec = pow(max(dot(normalize(normal + lightDir), viewDir), 0.0), 64.0);
          finalColor += spec * 0.35;

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });
    renderMaterialRef.current = renderMaterial;
    const fullScreenQuad = new THREE.PlaneGeometry(2, 2);
    const simMesh = new THREE.Mesh(fullScreenQuad, simMaterial);
    const renderMesh = new THREE.Mesh(fullScreenQuad, renderMaterial);
    let frameHandle = 0;
    const randBetween = (min, max) => min + Math.random() * (max - min);
    const playRain = () => {
      const ctx = audioCtxRef.current;
      const buffers = buffersRef.current;
      const conv = convolverRef.current;
      const masterGain = masterGainRef.current;
      if (!ctx || !buffers.rain || !conv || !masterGain) return;
      const now = performance.now();
      if (now - lastRainSoundTimeRef.current < 80) return;
      lastRainSoundTimeRef.current = now;
      const src = ctx.createBufferSource();
      src.buffer = buffers.rain;
      src.playbackRate.value = randBetween(0.9, 1.1);
      const sendGain = ctx.createGain();
      sendGain.gain.value = randBetween(0.3, 0.45);
      src.connect(sendGain);
      sendGain.connect(conv);
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {
        });
      }
      src.start();
    };
    const playUser = () => {
      const ctx = audioCtxRef.current;
      const buffers = buffersRef.current;
      const conv = convolverRef.current;
      const masterGain = masterGainRef.current;
      if (!ctx || !buffers.user || !conv || !masterGain) return;
      const now = performance.now();
      if (now - lastUserSoundTimeRef.current < 120) return;
      lastUserSoundTimeRef.current = now;
      const src = ctx.createBufferSource();
      src.buffer = buffers.user;
      src.playbackRate.value = randBetween(0.95, 1.15);
      const sendGain = ctx.createGain();
      sendGain.gain.value = randBetween(0.55, 0.75);
      src.connect(sendGain);
      sendGain.connect(conv);
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {
        });
      }
      src.start();
    };
    const animate = (time) => {
      frameHandle = requestAnimationFrame(animate);
      if (!targetsRef.current) return;
      const fpsState = fpsStateRef.current;
      const now = time;
      if (fpsState.lastTime > 0) {
        const dt = (now - fpsState.lastTime) / 1e3;
        fpsState.frameCount += 1;
        if (now - fpsState.lastFpsCheck >= 1e3 && dt > 0) {
          const instantFps = fpsState.frameCount * 1e3 / (now - fpsState.lastFpsCheck);
          fpsState.avgFps = fpsState.avgFps * 0.8 + instantFps * 0.2;
          fpsState.frameCount = 0;
          fpsState.lastFpsCheck = now;
          if (now - fpsState.lastAdjust > 3e3 && rendererRef.current) {
            const targetHigh = 70;
            const targetLow = 50;
            let newScale = fpsState.scale;
            if (fpsState.avgFps > targetHigh && newScale < 1.25) {
              newScale = Math.min(1.25, newScale + 0.1);
            } else if (fpsState.avgFps < targetLow && newScale > 0.6) {
              newScale = Math.max(0.6, newScale - 0.1);
            }
            if (Math.abs(newScale - fpsState.scale) > 0.01) {
              fpsState.scale = newScale;
              fpsState.lastAdjust = now;
              const effectivePixelRatio = fpsState.basePixelRatio * fpsState.scale;
              rendererRef.current.setPixelRatio(effectivePixelRatio);
            }
          }
        }
      } else {
        fpsState.lastFpsCheck = now;
      }
      fpsState.lastTime = now;
      const { read, write, old } = targetsRef.current;
      const currentConfig = configRef.current;
      if (isMouseDown.current || mouseRef.current.distanceTo(prevMouseRef.current) > 1e-3) {
        simMaterial.uniforms.uDropPos.value.copy(mouseRef.current);
        prevMouseRef.current.copy(mouseRef.current);
      } else {
        const nowMs = performance.now();
        const rainState = rainIntensityStateRef.current;
        if (nowMs - rainState.lastUpdate > 4e3) {
          const base = currentConfig.rainIntensity;
          const randomFactor = 0.3 + Math.random() * 1.7;
          rainState.target = Math.max(0, base * randomFactor);
          rainState.lastUpdate = nowMs;
        }
        rainState.current += (rainState.target - rainState.current) * 0.01;
        if (currentConfig.autoRain && Math.random() < rainState.current) {
          simMaterial.uniforms.uDropPos.value.set(Math.random(), Math.random());
          playRain();
        } else {
          simMaterial.uniforms.uDropPos.value.set(-1, -1);
        }
      }
      simMaterial.uniforms.uCurrent.value = read.texture;
      simMaterial.uniforms.uPrev.value = old.texture;
      renderer.setRenderTarget(write);
      renderer.render(simMesh, camera);
      targetsRef.current.old = read;
      targetsRef.current.read = write;
      targetsRef.current.write = old;
      renderMaterial.uniforms.uWaterHeight.value = targetsRef.current.read.texture;
      renderMaterial.uniforms.uTime.value = time * 1e-3;
      const carousel = carouselStateRef.current;
      if (!crossfadeStateRef.current.active && carousel.textures.length > 1) {
        const nowMs = performance.now();
        if (nowMs - carousel.lastSwitchTime >= carousel.switchInterval) {
          const nextIndex = (carousel.currentIndex + 1) % carousel.textures.length;
          const nextTexture = carousel.textures[nextIndex];
          floorTexBRef.current = nextTexture;
          renderMaterial.uniforms.uFloorTexB.value = nextTexture;
          renderMaterial.uniforms.uMixFactor.value = 0;
          crossfadeStateRef.current = {
            active: true,
            startTime: nowMs,
            duration: 2e3
          };
          carousel.currentIndex = nextIndex;
          carousel.lastSwitchTime = nowMs;
        }
      }
      const cf = crossfadeStateRef.current;
      if (cf.active) {
        const t = (performance.now() - cf.startTime) / cf.duration;
        const mix = Math.min(Math.max(t, 0), 1);
        renderMaterial.uniforms.uMixFactor.value = mix;
        if (mix >= 1 && floorTexBRef.current) {
          floorTexARef.current = floorTexBRef.current;
          renderMaterial.uniforms.uFloorTexA.value = floorTexARef.current;
          renderMaterial.uniforms.uMixFactor.value = 0;
          crossfadeStateRef.current.active = false;
        }
      }
      renderer.setRenderTarget(null);
      renderer.render(renderMesh, camera);
    };
    frameHandle = requestAnimationFrame(animate);
    const onResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const newAspect = w / h;
      rendererRef.current.setSize(w, h);
      const newSimResX = SIM_RES_BASE;
      const newSimResY = Math.round(SIM_RES_BASE / newAspect);
      if (targetsRef.current) {
        targetsRef.current.read.dispose();
        targetsRef.current.write.dispose();
        targetsRef.current.old.dispose();
      }
      targetsRef.current = createTargets(newSimResX, newSimResY);
      if (simMaterialRef.current) {
        simMaterialRef.current.uniforms.uTexelSize.value.set(
          1 / newSimResX,
          1 / newSimResY
        );
      }
      if (renderMaterialRef.current) {
        renderMaterialRef.current.uniforms.uTexelSize.value.set(
          1 / newSimResX,
          1 / newSimResY
        );
      }
    };
    const updateMouse = (e) => {
      const rect = containerRef.current.getBoundingClientRect();
      let x, y;
      if ("touches" in e) {
        if (e.touches.length === 0) return;
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      } else {
        x = e.clientX;
        y = e.clientY;
      }
      mouseRef.current.x = (x - rect.left) / rect.width;
      mouseRef.current.y = 1 - (y - rect.top) / rect.height;
    };
    const onMouseDown = (e) => {
      isMouseDown.current = true;
      updateMouse(e);
      playUser();
    };
    const onMouseMove = (e) => updateMouse(e);
    const onMouseUp = () => {
      isMouseDown.current = false;
    };
    window.addEventListener("resize", onResize);
    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("touchstart", onMouseDown, { passive: false });
    container.addEventListener("touchmove", onMouseMove, { passive: false });
    window.addEventListener("touchend", onMouseUp);
    return () => {
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("resize", onResize);
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("touchstart", onMouseDown);
      container.removeEventListener("touchmove", onMouseMove);
      window.removeEventListener("touchend", onMouseUp);
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
      if (targetsRef.current) {
        targetsRef.current.read.dispose();
        targetsRef.current.write.dispose();
        targetsRef.current.old.dispose();
      }
      const texturesToDispose = new Set(carouselStateRef.current.textures);
      if (floorTexARef.current) texturesToDispose.add(floorTexARef.current);
      if (floorTexBRef.current) texturesToDispose.add(floorTexBRef.current);
      texturesToDispose.forEach((tex) => tex && tex.dispose && tex.dispose());
      fullScreenQuad.dispose();
      simMaterial.dispose();
      renderMaterial.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);
  useEffect(() => {
    if (simMaterialRef.current) {
      simMaterialRef.current.uniforms.uDamping.value = config.damping;
      simMaterialRef.current.uniforms.uDropRadius.value = config.dropRadius;
      simMaterialRef.current.uniforms.uDropStrength.value = config.dropStrength;
    }
    if (renderMaterialRef.current) {
      renderMaterialRef.current.uniforms.uRefractionScale.value = config.refractionScale;
      renderMaterialRef.current.uniforms.uReflectionStrength.value = config.reflectionStrength;
    }
    rainIntensityStateRef.current.current = config.rainIntensity;
    rainIntensityStateRef.current.target = config.rainIntensity;
  }, [config]);
  return /* @__PURE__ */ jsxDEV(
    "div",
    {
      ref: containerRef,
      style: {
        width: "100%",
        height: "100%"
      }
    },
    void 0,
    false,
    {
      fileName: "<stdin>",
      lineNumber: 651,
      columnNumber: 5
    }
  );
};
var stdin_default = WaterSimulation;
export {
  stdin_default as default
};
