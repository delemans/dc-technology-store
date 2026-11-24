// herramientas/videos-diciembre-codificar.js — Arma el MP4 dentro de Chrome (sin programas extra):
// música original sintetizada (campanas, cine o ritmo, sincronizada con los golpes de la animación) + cuadros JPG
// → H.264 + AAC con WebCodecs → MP4 (mp4-muxer). Todo determinista.
/* global Mp4Muxer */
(() => {
    const SR = 48000;
    const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);

    async function sintetizar({ dur, eventos, beat, musica }) {
        const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
        const master = ctx.createGain(); master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.85, 0.08);
        master.gain.setValueAtTime(0.85, Math.max(0.1, dur - 0.9)); master.gain.linearRampToValueAtTime(0, dur);
        master.connect(comp).connect(ctx.destination);
        // reverberación (impulso generado)
        const imp = ctx.createBuffer(2, SR * 2.4, SR); let s = 11;
        for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * Math.pow(1 - i / d.length, 3.2); } }
        const rev = ctx.createConvolver(); rev.buffer = imp; const revG = ctx.createGain(); revG.gain.value = 0.28; rev.connect(revG).connect(master);
        const ruido = ctx.createBuffer(1, SR * 2, SR); { const d = ruido.getChannelData(0); for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; } }
        const fin = (t) => t < dur;

        function campana(t, m, v = 0.16, pan = 0) {
            if (!fin(t)) return; const f = mf(m); const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(master); p.connect(rev);
            [[1, 1, 1.8], [2, 0.45, 1], [3.01, 0.22, 0.6], [4.16, 0.16, 0.35], [5.43, 0.08, 0.22]].forEach(([r, a, d]) => {
                const o = ctx.createOscillator(); o.frequency.value = f * r; const g = ctx.createGain();
                g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
                o.connect(g).connect(p); o.start(t); o.stop(t + d + 0.05);
            });
        }
        function pad(t, notas, d, v = 0.03, corte = 1100) {
            if (!fin(t)) return; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = corte; const g = ctx.createGain();
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.4); g.gain.setValueAtTime(v, t + Math.max(0.45, d - 0.25)); g.gain.linearRampToValueAtTime(0, t + d + 0.25);
            lp.connect(g); g.connect(master); g.connect(rev);
            notas.forEach((m) => [-8, 0, 8].forEach((det) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mf(m); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + d + 0.3); }));
        }
        function bajo(t, m, d, v = 0.22) {
            if (!fin(t)) return; const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mf(m); const g = ctx.createGain();
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.05);
        }
        function ruidoHit(t, { tipo = 'highpass', f = 7000, fFin, q = 1, v = 0.08, d = 0.06, sube = 0.004 }) {
            if (!fin(t)) return; const b = ctx.createBufferSource(); b.buffer = ruido; const bq = ctx.createBiquadFilter(); bq.type = tipo; bq.frequency.setValueAtTime(f, t);
            if (fFin) bq.frequency.exponentialRampToValueAtTime(fFin, t + d); bq.Q.value = q; const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + sube); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
            b.connect(bq).connect(g).connect(master); b.start(t, (t * 0.37) % 1.5); b.stop(t + d + 0.05);
        }
        function bombo(t, v = 0.9) {
            if (!fin(t)) return; const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
            const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42); o.connect(g).connect(master); o.start(t); o.stop(t + 0.5);
        }
        const palma = (t, v = 0.22) => ruidoHit(t, { tipo: 'bandpass', f: 1500, q: 0.9, v, d: 0.14 });
        const cascabel = (t, v = 0.035) => ruidoHit(t, { tipo: 'highpass', f: 8500, v, d: 0.07 });
        const sonidos = {
            golpe: (t) => { bombo(t, 0.95); ruidoHit(t, { tipo: 'lowpass', f: 2600, v: 0.28, d: 0.4 }); campana(t, 74, 0.15); campana(t, 81, 0.1, 0.3); },
            brillo: (t) => [86, 90, 93, 98, 102, 105].forEach((m, i) => campana(t + i * 0.05, m, 0.06, i % 2 ? 0.45 : -0.45)),
            whoosh: (t) => ruidoHit(t, { tipo: 'bandpass', f: 350, fFin: 4200, q: 1.4, v: 0.2, d: 0.6, sube: 0.42 }),
            tic: (t) => campana(t, 93, 0.05, 0.3),
            bombo: (t) => bombo(t, 0.7),
            boom: (t) => { bombo(t, 1); const o = ctx.createOscillator(); o.frequency.setValueAtTime(58, t); o.frequency.exponentialRampToValueAtTime(30, t + 2.2); const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4); o.connect(g); g.connect(master); g.connect(rev); o.start(t); o.stop(t + 2.5); ruidoHit(t, { tipo: 'lowpass', f: 900, v: 0.22, d: 1.0 }); },
            drone: () => {},
        };

        // Lecho musical original (progresión I–vi–IV–V en Re; el tráiler, en Re menor)
        const MAYOR = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]];
        const MENOR = [[62, 65, 69], [58, 62, 65], [53, 57, 60], [55, 60, 64]];
        if (musica === 'cine') {
            for (let i = 0, t = 0; t < dur; i++, t += 3.2) { const c = MENOR[i % 4]; pad(t, c.map((m) => m - 12), 3.2, 0.032, 800); bajo(t, c[0] - 24, 3, 0.18); if (i % 2) campana(t + 1.6, c[2] + 12, 0.06, -0.3); }
            for (let t = 0.2; t < dur; t += 0.8) ruidoHit(t, { tipo: 'highpass', f: 9000, v: 0.012, d: 0.05 });
        } else if (musica === 'ritmo') {
            const b = beat || 0.4;
            for (let k = 0, t = 0; t < dur; k++, t += b) {
                const c = MAYOR[Math.floor(k / 4) % 4];
                bombo(t, k % 4 === 0 ? 0.75 : 0.55); if (k % 2) palma(t); cascabel(t + b / 2, 0.05); cascabel(t, 0.03);
                bajo(t, c[0] - 24, b * 0.9, 0.2); bajo(t + b / 2, c[0] - 12, b * 0.4, 0.12);
                campana(t, c[(k % 3)] + 12, 0.075, k % 2 ? 0.35 : -0.35); if (k % 4 === 0) pad(t, c.map((m) => m - 12), b * 4, 0.02, 1400);
            }
        } else {
            // campanas: arpegio en corcheas, cascabeles, colchón y bajo suave (112 ppm)
            const b = 60 / 112;
            for (let k = 0, t = 0; t < dur; k++, t += b / 2) {
                const compas = Math.floor(k / 8), c = MAYOR[compas % 4];
                const nota = [0, 1, 2, 1, 2, 0, 1, 2][k % 8] + (k % 8 >= 4 ? 3 : 0);
                const m = [...c, ...c.map((x) => x + 12)][nota] + 12;
                campana(t, m, k % 2 ? 0.07 : 0.1, k % 2 ? 0.3 : -0.3);
                cascabel(t, k % 2 ? 0.03 : 0.05);
                if (k % 8 === 0) { pad(t, c.map((x) => x - 12), b * 4, 0.024); bajo(t, c[0] - 24, b * 2, 0.2); bajo(t + b * 2, c[0] - 24, b * 2, 0.16); }
                if (k % 4 === 0 && t > 1.5) bombo(t, 0.3);
            }
        }
        for (const e of eventos ?? []) sonidos[e.tipo]?.(e.t);
        return ctx.startRendering();
    }

    window.codificar = async ({ id, cuadros, fps, dur, eventos, beat, musica }) => {
        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
            video: { codec: 'avc', width: 1080, height: 1920, frameRate: fps },
            audio: { codec: 'aac', numberOfChannels: 2, sampleRate: SR },
        });
        let falla = null;
        const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { falla = e; } });
        ve.configure({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: cuadros > 600 ? 3_800_000 : 6_000_000, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
        const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { falla = e; } });
        ae.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });
        // audio primero (intercalado lo resuelve el muxer en memoria)
        const buf = await sintetizar({ dur: cuadros / fps, eventos, beat, musica });
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        for (let s0 = 0; s0 < L.length; s0 += 4800) {
            const k = Math.min(4800, L.length - s0); const d = new Float32Array(k * 2); d.set(L.subarray(s0, s0 + k), 0); d.set(R.subarray(s0, s0 + k), k);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round((s0 * 1e6) / SR), data: d });
            ae.encode(ad); ad.close();
        }
        await ae.flush();
        let siguiente = fetch(`/cuadros/${id}/0.jpg`).then((r) => r.blob());
        for (let i = 0; i < cuadros; i++) {
            const blob = await siguiente;
            if (i + 1 < cuadros) siguiente = fetch(`/cuadros/${id}/${i + 1}.jpg`).then((r) => r.blob());
            const bm = await createImageBitmap(blob);
            const f = new VideoFrame(bm, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
            ve.encode(f, { keyFrame: i % (fps * 2) === 0 }); f.close(); bm.close();
            while (ve.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
            if (falla) throw falla;
        }
        await ve.flush();
        if (falla) throw falla;
        muxer.finalize();
        const r = await fetch(`/guardar/${id}`, { method: 'POST', body: muxer.target.buffer });
        return r.ok ? `ok ${muxer.target.buffer.byteLength}` : `error ${r.status}`;
    };
})();
