// platforms/linkedin.js
// LinkedIn platform configuration — sets window.ToystallerActivePlatform (content world)
// and window.ToystallerPlatform (MAIN world for interceptor).

(function() {
    function computeStreamScore(srcUrl, type, bitrate, height) {
        let score = parseInt(bitrate || '0', 10);
        const lower = (srcUrl || '').toLowerCase();
        const h = parseInt(height || '0', 10);

        if (lower.includes('1080') || h >= 1080) score += 4000000;
        else if (lower.includes('720') || h >= 720) score += 2000000;
        else if (lower.includes('480') || h >= 480) score += 800000;
        else if (lower.includes('360') || h >= 360) score += 300000;

        const isMp4 = (type && type.includes('mp4')) || lower.includes('.mp4');
        if (isMp4 && score >= 1500000) score += 500000; // Prefer high-res progressive MP4
        return score;
    }

    const linkedinPlatform = {
        name: 'LinkedIn',
        version: 'v1.0',
        specialization: 'Specialized HD media extractor for LinkedIn — Feed, Profiles, Articles, Modals, and Messaging with Anti-Redirect HTML5 Player.',

        // --- Content Script Interface ---

        getPlatformConfig(path, media) {
            return { preferredCorners: ['top-left', 'top-right', 'bottom-right'], padding: 12, topOffset: 4 };
        },

        getContext(path) {
            const p = (path || window.location.pathname || '').toLowerCase();
            if (p.includes('/feed/')) return 'li-feed';
            if (p.includes('/pulse/') || p.includes('/article/')) return 'li-articles';
            if (p.includes('/messaging/')) return 'li-messaging';
            if (p.includes('/in/')) return 'li-profile';
            return 'linkedin';
        },

        hasActiveModal() {
            const modals = document.querySelectorAll('.artdeco-modal, [role="dialog"]');
            for (const modal of modals) {
                const rect = modal.getBoundingClientRect();
                if (rect.width > 400 && rect.height > 400) return true;
            }
            return false;
        },

        isInsideModal(media) {
            const modals = document.querySelectorAll('.artdeco-modal, [role="dialog"]');
            for (const modal of modals) {
                const rect = modal.getBoundingClientRect();
                if (rect.width > 400 && rect.height > 400 && modal.contains(media)) return true;
            }
            return false;
        },

        isThumbnail(media) {
            if (media.tagName.toLowerCase() !== 'img') return false;
            const rect = media.getBoundingClientRect();
            const naturalW = media.naturalWidth || media.width;
            const naturalH = media.naturalHeight || media.height;
            if (naturalW >= 200 && naturalH >= 200) return false;
            if (naturalW < 100 || naturalH < 100) return true;
            if (rect.width < 100 || rect.height < 100) return true;
            const style = window.getComputedStyle(media);
            if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius, 10) > 40)) return true;
            return false;
        },

        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (minSide < 180) return 0.85;
            if (minSide < 280) return 0.95;
            return 1;
        },

        useDirectDownload: false,
        useReactThumbnail: false,

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('//www.linkedin.com') || lower.includes('//linkedin.com');
        },

        upgradeImageUrl(url) {
            if (url && url.includes('media.licdn.com/dms/image')) {
                return url.replace(/\/(100|200|400|800)\//g, '/1000/');
            }
            return url;
        },

        extractThumbnail(media, interceptedUrls, safeSendMessage, callback) {
            if (interceptedUrls.size > 0) {
                const covers = Array.from(interceptedUrls).filter(u => u.includes('videocover'));
                if (covers.length > 0) {
                    callback(covers[0]);
                    return;
                }
            }

            safeSendMessage({ action: 'getMediaUrls', mediaType: 'img' }, (response) => {
                if (response && response.urls && response.urls.length > 0) {
                    const covers = response.urls.filter(u => u.includes('videocover'));
                    if (covers.length > 0) {
                        callback(covers[0]);
                        return;
                    }
                }
                callback(null);
            });
        },

        filterBackgroundUrls(candidates, isVideo) {
            return candidates.filter(u => {
                const lower = u.toLowerCase();
                if (isVideo && (lower.includes('videocover') || lower.includes('/image/') || lower.includes('.jpg') || lower.includes('.png') || lower.includes('.webp'))) {
                    return false;
                }
                if (lower.includes('.mpd') || lower.includes('stream_type=dash') || lower.includes('bytestart') || lower.includes('/audio')) {
                    return false;
                }
                return (lower.includes('licdn.com') && (lower.includes('playlist/vid') || lower.includes('video') || lower.includes('playback') || lower.includes('progressive'))) || lower.includes('.mp4');
            });
        },

        // --- Interceptor Interface (MAIN world) ---

        getInterceptUrls() {
            return ['linkedin.com', '/api/v', 'voyager/api', 'dms.licdn.com'];
        },

        shouldSkipReactValue(val, key, isVideoContext) {
            const lowerVal = val.toLowerCase();
            return lowerVal.includes('//www.linkedin.com') || lowerVal.includes('//linkedin.com');
        },

        looksLikeReactImage(val, key) {
            const lowerVal = val.toLowerCase();
            const lowerKey = (key || '').toLowerCase();
            return (
                lowerKey.includes('image') ||
                lowerKey.includes('thumbnail') ||
                lowerKey.includes('cover') ||
                lowerVal.includes('.jpg') ||
                lowerVal.includes('.png') ||
                lowerVal.includes('.webp') ||
                lowerVal.includes('.heic') ||
                lowerVal.includes('/image/')
            );
        },

        looksLikeReactVideo(val, key) {
            if (!val || typeof val !== 'string' || !val.startsWith('http')) return false;
            const lowerVal = val.toLowerCase();
            const lowerKey = (key || '').toLowerCase();

            if (lowerVal.includes('/image/') || lowerVal.includes('videocover') || lowerVal.includes('.jpg') || lowerVal.includes('.png') || lowerVal.includes('.webp') || lowerVal.includes('.heic')) {
                return false;
            }

            if (lowerVal.includes('.mpd') || lowerVal.includes('stream_type=dash') || lowerVal.includes('/manifest') || lowerVal.includes('bytestart') || lowerVal.includes('/audio') || lowerKey.includes('audio')) {
                return false;
            }

            if (lowerVal.includes('.mp4') || lowerVal.includes('.m4v')) {
                return true;
            }

            return lowerVal.includes('licdn.com') && (lowerVal.includes('playlist/vid') || lowerVal.includes('video') || lowerVal.includes('playback') || lowerVal.includes('progressive'));
        },

        extractPriorityReactUrl(val, isVideoContext) {
            if (!val || typeof val !== 'object') return null;

            // 1. LinkedIn Voyager VideoPlayMetadata: progressiveStreams array (sort for highest quality)
            if (Array.isArray(val.progressiveStreams) && val.progressiveStreams.length > 0) {
                let bestStream = null;
                let bestScore = -1;
                for (const stream of val.progressiveStreams) {
                    if (!stream) continue;
                    let streamUrl = stream.streamingLocation || stream.url || stream.src;
                    if (!streamUrl || typeof streamUrl !== 'string' || !streamUrl.startsWith('http')) continue;
                    if (streamUrl.includes('manifest') || streamUrl.includes('.mpd') || streamUrl.includes('/audio')) continue;

                    streamUrl = streamUrl.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
                    const score = computeStreamScore(streamUrl, stream.mediaType, stream.bitRate || stream.bitrate, stream.height);
                    if (score > bestScore) {
                        bestScore = score;
                        bestStream = streamUrl;
                    }
                }
                if (bestStream) return bestStream.split('#')[0];
            }

            // 2. Adaptive HLS streams for long recordings & live events if progressive is unavailable
            if (Array.isArray(val.adaptiveStreams) && val.adaptiveStreams.length > 0) {
                for (const stream of val.adaptiveStreams) {
                    if (!stream) continue;
                    let streamUrl = stream.streamingLocation || stream.url || stream.src;
                    if (streamUrl && typeof streamUrl === 'string' && streamUrl.startsWith('http')) {
                        if (!streamUrl.includes('.mpd') && !streamUrl.includes('dash')) {
                            return streamUrl.replace(/&amp;/g, '&').replace(/\\u0026/g, '&').split('#')[0];
                        }
                    }
                }
            }

            // 3. Direct progressive stream object with streamingLocation
            if (typeof val.streamingLocation === 'string' && val.streamingLocation.startsWith('http')) {
                if (!val.streamingLocation.includes('manifest') && !val.streamingLocation.includes('.mpd')) {
                    return val.streamingLocation.replace(/&amp;/g, '&').split('#')[0];
                }
            }

            // 4. streamingUrl or progressiveUrl
            if (typeof val.streamingUrl === 'string' && val.streamingUrl.startsWith('http')) {
                if (!val.streamingUrl.includes('manifest') && !val.streamingUrl.includes('.mpd')) {
                    return val.streamingUrl.replace(/&amp;/g, '&').split('#')[0];
                }
            }
            if (typeof val.progressiveUrl === 'string' && val.progressiveUrl.startsWith('http')) {
                if (!val.progressiveUrl.includes('manifest') && !val.progressiveUrl.includes('.mpd')) {
                    return val.progressiveUrl.replace(/&amp;/g, '&').split('#')[0];
                }
            }

            return null;
        },

        isValidVideo(url) {
            if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
            const lower = url.toLowerCase();
            if (lower.includes('.mpd') || lower.includes('stream_type=dash')) return false;
            if (lower.includes('/audio') || lower.includes('bytestart')) return false;
            return !(lower.includes('//www.linkedin.com') || lower.includes('//linkedin.com'));
        },

        extractVideoUrlFromDOM(el) {
            if (!el) return null;

            const targetEl = (el.tagName === 'VIDEO' ? el : (el.querySelector ? el.querySelector('video') : el)) || el;
            const container = targetEl.closest ? targetEl.closest('.feed-shared-video-player, .feed-shared-update-v2, .update-components-video, .video-js, div[data-urn], article, .artdeco-modal, .msg-s-message-list-content') : null;

            // 1. Check data-sources attribute on targetEl, container, or parent chain
            let sourcesData = targetEl.getAttribute ? targetEl.getAttribute('data-sources') : null;

            if (!sourcesData && container) {
                const withSources = container.querySelector('[data-sources]');
                if (withSources) sourcesData = withSources.getAttribute('data-sources');
            }

            if (!sourcesData) {
                let parent = targetEl.parentElement;
                for (let i = 0; i < 6 && parent; i++) {
                    if (parent.hasAttribute && parent.hasAttribute('data-sources')) {
                        sourcesData = parent.getAttribute('data-sources');
                        break;
                    }
                    parent = parent.parentElement;
                }
            }

            // 2. Parse data-sources with highest quality prioritization
            if (sourcesData) {
                try {
                    let raw = sourcesData;
                    if (typeof raw === 'string') {
                        if (raw.includes('&quot;') || raw.includes('&amp;')) {
                            const txt = document.createElement('textarea');
                            txt.innerHTML = raw;
                            raw = txt.value;
                        }
                        sourcesData = JSON.parse(raw);
                    }
                    if (Array.isArray(sourcesData)) {
                        let bestCandidate = null;
                        let bestScore = -1;

                        for (const src of sourcesData) {
                            if (!src) continue;
                            let srcUrl = src.src || src.url || src.streamingLocation;
                            if (srcUrl && typeof srcUrl === 'string' && this.isValidVideo(srcUrl)) {
                                srcUrl = srcUrl.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
                                if (srcUrl.includes('manifest') || srcUrl.includes('.mpd') || srcUrl.includes('/audio')) continue;
                                if (src.type && src.type.includes('dash')) continue;

                                const bitrate = parseInt(src['data-bitrate'] || src.bitRate || src.bitrate || '0', 10);
                                const height = parseInt(src.height || '0', 10);
                                const score = computeStreamScore(srcUrl, src.type, bitrate, height);

                                if (score > bestScore || !bestCandidate) {
                                    bestScore = score;
                                    bestCandidate = srcUrl;
                                }
                            }
                        }
                        if (bestCandidate) return bestCandidate.split('#')[0];
                    }
                } catch (e) {}
            }

            // 3. Check for server-rendered JSON in <code> or <script> tags inside the post
            if (container) {
                const codeElements = container.querySelectorAll('code, script[type="application/json"]');
                for (const code of codeElements) {
                    const content = code.textContent || '';
                    if (content.includes('progressiveStreams') || content.includes('dms.licdn.com/playlist/vid')) {
                        try {
                            const cleaned = content.replace(/^<!--/, '').replace(/-->$/, '').trim();
                            const data = JSON.parse(cleaned);
                            const found = this.extractPriorityReactUrl(data, true);
                            if (found) return found;
                        } catch (e) {}
                    }
                }
            }

            // 4. Check for video attributes like data-playback-url, data-video-url, data-stream-url
            const attrNames = ['data-playback-url', 'data-video-url', 'data-stream-url', 'data-url'];
            for (const attr of attrNames) {
                const val = targetEl.getAttribute(attr) || (container && container.getAttribute(attr));
                if (val && typeof val === 'string' && val.startsWith('http') && this.isValidVideo(val)) {
                    return val.replace(/&amp;/g, '&').split('#')[0];
                }
            }

            // 5. Fallback: Direct non-blob src or source children
            const currentSrc = targetEl.currentSrc || targetEl.src;
            if (currentSrc && typeof currentSrc === 'string' && !currentSrc.startsWith('blob:') && !currentSrc.startsWith('data:') && this.isValidVideo(currentSrc)) {
                return currentSrc.split('#')[0];
            }

            const sourceTags = targetEl.querySelectorAll ? targetEl.querySelectorAll('source') : [];
            for (const s of sourceTags) {
                if (s.src && !s.src.startsWith('blob:') && !s.src.startsWith('data:') && this.isValidVideo(s.src)) {
                    return s.src.split('#')[0];
                }
            }

            return null;
        }
    };

    if (typeof window !== 'undefined') {
        window.ToystallerPlatform = linkedinPlatform;
        window.ToystallerActivePlatform = linkedinPlatform;
    }
})();
