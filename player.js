// player.js
// Handles video playback and direct download inside the Toystaller Master Player tab.
// Supports: Direct Progressive MP4, Forced High-Definition Adaptive HLS (Hls.js),
// Concurrent Fragmented MP4 Segment Downloader for Long Videos (1-3 hrs),
// and the Interactive Stream Recovery Assistant for 0:00 / lazy-loaded streams.

(function() {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const rawUrl = params.get('url');

    const player = document.getElementById('videoPlayer');
    const dlBtn = document.getElementById('dlBtn');
    const copyBtn = document.getElementById('copyBtn');
    const tipsBtn = document.getElementById('tipsBtn');
    const resText = document.getElementById('resolutionText');
    const bigPlayBtn = document.getElementById('bigPlayBtn');
    const qualitySelect = document.getElementById('qualitySelect');
    const qualitySeparator = document.getElementById('qualitySeparator');
    const recoveryCard = document.getElementById('recoveryCard');
    const retryBtn = document.getElementById('retryBtn');
    const fallbackDlBtn = document.getElementById('fallbackDlBtn');
    const tipsModal = document.getElementById('tipsModal');
    const closeTipsBtn = document.getElementById('closeTipsBtn');

    if (!rawUrl) {
        document.body.innerHTML = `
            <div style="color:#e4e6eb;font-family:sans-serif;text-align:center;margin-top:25vh;">
                <h2>No video link specified</h2>
                <p style="margin-top:10px;color:#8a8d91;">Please close this tab and click the download button on a LinkedIn video.</p>
            </div>
        `;
        return;
    }

    // Strip any fragment identifier and normalize entities
    const videoUrl = rawUrl.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').split('#')[0];
    const isHls = videoUrl.includes('/pl/') || videoUrl.includes('.m3u8') || videoUrl.includes('format=m3u8') || videoUrl.includes('hls-');

    let hlsInstance = null;
    let bufferedBlobUrl = null;
    let blobAttempted = false;
    let streamLoadTimeout = null;

    // --- Helper Functions ---

    function showBigPlayBtn() {
        if (bigPlayBtn) bigPlayBtn.style.display = 'flex';
    }

    function hideBigPlayBtn() {
        if (bigPlayBtn) bigPlayBtn.style.display = 'none';
    }

    function showRecoveryCard() {
        if (recoveryCard) {
            recoveryCard.style.display = 'block';
            resText.textContent = 'Stream requires LinkedIn interaction';
            resText.style.color = '#f5a623';
        }
    }

    function hideRecoveryCard() {
        if (recoveryCard) recoveryCard.style.display = 'none';
    }

    // Playback control
    if (bigPlayBtn) {
        bigPlayBtn.addEventListener('click', () => {
            player.play().then(hideBigPlayBtn).catch(() => {});
        });
    }

    player.addEventListener('play', hideBigPlayBtn);
    player.addEventListener('pause', () => {
        if (player.currentTime === 0) showBigPlayBtn();
    });

    // Pro Tips Modal
    if (tipsBtn && tipsModal) {
        tipsBtn.addEventListener('click', () => tipsModal.classList.add('active'));
    }
    if (closeTipsBtn && tipsModal) {
        closeTipsBtn.addEventListener('click', () => tipsModal.classList.remove('active'));
    }
    if (tipsModal) {
        tipsModal.addEventListener('click', (e) => {
            if (e.target === tipsModal) tipsModal.classList.remove('active');
        });
    }

    // Retry Stream Button
    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            hideRecoveryCard();
            resText.textContent = 'Reconnecting to stream...';
            resText.style.color = '#70b5f9';
            initPlayer();
        });
    }

    // Fallback Background Download Button
    if (fallbackDlBtn) {
        fallbackDlBtn.addEventListener('click', () => {
            const filename = `LinkedIn_Video_${Date.now()}.mp4`;
            chrome.runtime.sendMessage({
                action: 'downloadMedia',
                url: videoUrl,
                filename: filename
            }, (response) => {
                fallbackDlBtn.textContent = response && response.success ? 'Download Started' : 'Download Failed';
                setTimeout(() => { fallbackDlBtn.textContent = '📥 Direct Download'; }, 2500);
            });
        });
    }

    // --- Stream Initialization Engine ---

    function initPlayer() {
        clearTimeout(streamLoadTimeout);
        hideRecoveryCard();

        // If after 6 seconds the stream still has 0 duration and is not playing, show recovery helper
        streamLoadTimeout = setTimeout(() => {
            if (player.duration === 0 || isNaN(player.duration)) {
                console.warn('Toystaller: Stream duration is 0 after 6s timeout, displaying Recovery Assistant');
                showRecoveryCard();
            }
        }, 6000);

        if (isHls && window.Hls && Hls.isSupported()) {
            resText.textContent = 'Loading adaptive HD stream...';
            resText.style.color = '#70b5f9';

            if (hlsInstance) {
                hlsInstance.destroy();
                hlsInstance = null;
            }

            hlsInstance = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 180,
                maxBufferLength: 60,
                maxMaxBufferLength: 600,
                startLevel: -1
            });

            hlsInstance.loadSource(videoUrl);
            hlsInstance.attachMedia(player);

            hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                clearTimeout(streamLoadTimeout);
                hideRecoveryCard();

                // Force the highest quality stream level (1080p / highest available)
                if (data && data.levels && data.levels.length > 0) {
                    let bestIdx = 0;
                    let bestH = 0;
                    data.levels.forEach((lvl, idx) => {
                        const h = lvl.height || 0;
                        if (h > bestH) {
                            bestH = h;
                            bestIdx = idx;
                        }
                    });

                    // Lock to highest quality
                    hlsInstance.currentLevel = bestIdx;
                    hlsInstance.loadLevel = bestIdx;

                    resText.textContent = `${bestH || 'HD'}p Master Stream`;
                    resText.style.color = '#8a8d91';

                    // Populate Quality Selector
                    if (qualitySelect && qualitySeparator && data.levels.length > 1) {
                        qualitySelect.innerHTML = '';
                        // Auto option
                        const autoOpt = document.createElement('option');
                        autoOpt.value = '-1';
                        autoOpt.textContent = `Auto (Best ${bestH}p)`;
                        qualitySelect.appendChild(autoOpt);

                        data.levels.forEach((lvl, idx) => {
                            const opt = document.createElement('option');
                            opt.value = idx.toString();
                            opt.textContent = `${lvl.height || 'HD'}p (${Math.round((lvl.bitrate || 0) / 1000)}k)`;
                            if (idx === bestIdx) opt.selected = true;
                            qualitySelect.appendChild(opt);
                        });

                        qualitySelect.style.display = 'inline-block';
                        qualitySeparator.style.display = 'inline';

                        qualitySelect.onchange = () => {
                            const val = parseInt(qualitySelect.value, 10);
                            hlsInstance.currentLevel = val;
                            if (val >= 0 && hlsInstance.levels[val]) {
                                resText.textContent = `${hlsInstance.levels[val].height}p Video`;
                            } else {
                                resText.textContent = `${bestH}p Master Stream`;
                            }
                        };
                    }
                }

                player.play().then(hideBigPlayBtn).catch(() => {
                    showBigPlayBtn();
                });
            });

            hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                if (hlsInstance.levels && hlsInstance.levels[data.level]) {
                    const l = hlsInstance.levels[data.level];
                    resText.textContent = `${l.width} x ${l.height} • HD Video`;
                    resText.style.color = '#8a8d91';
                }
            });

            hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.warn('HLS fatal error:', data);
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            hlsInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            hlsInstance.recoverMediaError();
                            break;
                        default:
                            showRecoveryCard();
                            break;
                    }
                }
            });
        } else {
            // Progressive MP4 stream
            resText.textContent = 'Connecting to HD stream...';
            resText.style.color = '#70b5f9';
            player.src = videoUrl;
            player.load();

            player.play().then(hideBigPlayBtn).catch(() => {
                showBigPlayBtn();
            });

            player.addEventListener('loadedmetadata', () => {
                clearTimeout(streamLoadTimeout);
                if (player.duration > 0) {
                    hideRecoveryCard();
                    if (player.videoWidth && player.videoHeight) {
                        resText.textContent = `${player.videoWidth} x ${player.videoHeight} • HD MP4`;
                    } else {
                        resText.textContent = 'HD MP4 Video';
                    }
                    resText.style.color = '#8a8d91';

                    // Render initial frame thumbnail if paused at 0
                    if (player.currentTime === 0 && player.paused) {
                        try { player.currentTime = 0.001; } catch (e) {}
                    }
                } else {
                    showRecoveryCard();
                }
            });

            player.addEventListener('playing', () => {
                clearTimeout(streamLoadTimeout);
                hideRecoveryCard();
                hideBigPlayBtn();
                if (player.videoWidth && player.videoHeight) {
                    resText.textContent = `${player.videoWidth} x ${player.videoHeight} • HD MP4`;
                    resText.style.color = '#8a8d91';
                }
            });

            player.addEventListener('error', (e) => {
                console.warn('Player direct stream error:', player.error, e);
                // Fallback: Fetch directly as a Blob using extension host privileges
                if (!blobAttempted && !videoUrl.startsWith('blob:') && !videoUrl.startsWith('data:')) {
                    blobAttempted = true;
                    resText.textContent = 'Buffering HD stream via master pipeline...';
                    resText.style.color = '#0a66c2';

                    fetch(videoUrl)
                        .then(r => {
                            if (!r.ok) throw new Error('HTTP ' + r.status);
                            return r.blob();
                        })
                        .then(blob => {
                            clearTimeout(streamLoadTimeout);
                            hideRecoveryCard();
                            bufferedBlobUrl = URL.createObjectURL(blob);
                            player.src = bufferedBlobUrl;
                            player.load();
                            player.play().then(hideBigPlayBtn).catch(showBigPlayBtn);
                            resText.textContent = 'Direct Master Video';
                            resText.style.color = '#8a8d91';
                        })
                        .catch(err => {
                            console.warn('Blob buffer fallback failed:', err);
                            showRecoveryCard();
                        });
                } else {
                    showRecoveryCard();
                }
            });
        }
    }

    initPlayer();

    // --- High-Speed Concurrent Fragmented MP4 Assembler for Long Videos (1-3 Hours) ---

    async function fetchSegmentsConcurrent(segUrls, concurrency, onProgress) {
        const results = new Array(segUrls.length);
        let nextIndex = 0;
        let completedCount = 0;

        async function worker() {
            while (nextIndex < segUrls.length) {
                const currentIndex = nextIndex++;
                const segUrl = segUrls[currentIndex];
                try {
                    const res = await fetch(segUrl);
                    if (!res.ok) throw new Error(`Segment fetch status: ${res.status}`);
                    results[currentIndex] = await res.arrayBuffer();
                } catch (err) {
                    // Quick retry once on segment failure
                    const retryRes = await fetch(segUrl);
                    results[currentIndex] = await retryRes.arrayBuffer();
                }
                completedCount++;
                onProgress(completedCount, segUrls.length);
            }
        }

        const workers = [];
        const poolSize = Math.min(concurrency, segUrls.length);
        for (let i = 0; i < poolSize; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return results;
    }

    async function downloadHlsVideo(playlistUrl, filename, onProgress) {
        // 1. Fetch master or variant playlist
        const res = await fetch(playlistUrl);
        const text = await res.text();

        let variantUrl = playlistUrl;
        let variantText = text;

        // Check if master playlist containing multiple stream levels
        if (text.includes('#EXT-X-STREAM-INF')) {
            const lines = text.split('\n').map(l => l.trim());
            let bestBw = -1;
            let bestUri = null;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                    const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
                    const nextUri = lines[i + 1];
                    if (nextUri && !nextUri.startsWith('#')) {
                        if (bw > bestBw || !bestUri) {
                            bestBw = bw;
                            bestUri = nextUri;
                        }
                    }
                }
            }
            if (bestUri) {
                variantUrl = new URL(bestUri, playlistUrl).href;
                const variantRes = await fetch(variantUrl);
                variantText = await variantRes.text();
            }
        }

        const vLines = variantText.split('\n').map(l => l.trim());

        const mapLine = vLines.find(l => l.startsWith('#EXT-X-MAP:URI='));
        if (!mapLine) {
            throw new Error('Playlist missing fMP4 initialization segment');
        }
        const initMatch = mapLine.match(/URI=["']?([^"']+)["']?/);
        const initUrl = new URL(initMatch[1], variantUrl).href;

        const segUrls = vLines
            .filter(l => l && !l.startsWith('#'))
            .map(l => new URL(l, variantUrl).href);

        onProgress(0, segUrls.length + 1);

        // 2. Fetch initialization segment (contains ftyp + moov headers)
        const initRes = await fetch(initUrl);
        const initBuf = await initRes.arrayBuffer();
        onProgress(1, segUrls.length + 1);

        // 3. Fetch all media segments concurrently (5 concurrent workers for fast 1-3 hr downloads)
        const segBuffers = await fetchSegmentsConcurrent(segUrls, 5, (done, total) => {
            onProgress(done + 1, total + 1);
        });

        // 4. Combine buffers into unified master MP4 file
        const blob = new Blob([initBuf, ...segBuffers], { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(blobUrl);
        }, 30000);
    }

    function restoreDlBtn() {
        dlBtn.disabled = false;
        dlBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Download Video
        `;
    }

    dlBtn.addEventListener('click', () => {
        const idMatch = videoUrl.match(/\/([a-zA-Z0-9_\-]+)\.mp4/i) || 
                        videoUrl.match(/\/(\d+_[^/?]+)/) || 
                        videoUrl.match(/\/vid\/(?:pl\/)?(?:v\d+\/)?([a-zA-Z0-9_\-]+)/);
        const filename = idMatch ? `LinkedIn_${idMatch[1]}.mp4` : `LinkedIn_Video_${Date.now()}.mp4`;

        // If video was already fetched into local blob buffer, download instantly
        if (bufferedBlobUrl) {
            const a = document.createElement('a');
            a.href = bufferedBlobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 1000);
            dlBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Download Started
            `;
            setTimeout(restoreDlBtn, 2500);
            return;
        }

        if (isHls) {
            dlBtn.disabled = true;
            dlBtn.textContent = 'Preparing download...';

            downloadHlsVideo(videoUrl, filename, (curr, total) => {
                const pct = Math.round((curr / total) * 100);
                dlBtn.textContent = `Downloading ${pct}% (${curr}/${total})...`;
            }).then(() => {
                dlBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    Download Complete!
                `;
                setTimeout(restoreDlBtn, 2500);
            }).catch((err) => {
                console.warn('HLS concurrent assembly fallback:', err);
                chrome.runtime.sendMessage({
                    action: 'downloadMedia',
                    url: videoUrl,
                    filename: filename
                }, () => {
                    dlBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Download Started
                    `;
                    setTimeout(restoreDlBtn, 2500);
                });
            });
        } else {
            chrome.runtime.sendMessage({
                action: 'downloadMedia',
                url: videoUrl,
                filename: filename
            }, (response) => {
                if (response && response.success) {
                    dlBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Download Started
                    `;
                    setTimeout(restoreDlBtn, 2500);
                }
            });
        }
    });

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(videoUrl).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy Link
                `;
            }, 1800);
        });
    });
})();
