// extensions/linkedin/platform.js
// LinkedIn platform configuration — sets window.ToystallerActivePlatform (content world)
// and window.ToystallerPlatform (MAIN world for interceptor).

(function() {
    const linkedinPlatform = {
        name: 'LinkedIn',
        version: 'v6.0',
        specialization: 'High-res image and direct video downloads for LinkedIn Feed and Profiles. Bypasses LinkedIn CDN 403 errors using Chrome Downloads API.',

        // --- Content Script Interface ---

        getPlatformConfig(path) {
            return { preferredCorners: ['top-left', 'top-right', 'bottom-right'], padding: 12 };
        },

        getContext(path) {
            if (path.includes('/feed/')) return 'li-feed';
            if (path.includes('/messaging/')) return 'li-messaging';
            if (path.includes('/in/')) return 'li-profile';
            return 'linkedin';
        },

        hasActiveModal() {
            // LinkedIn uses .artdeco-modal for actual modals
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
            // LinkedIn profile pics and small icons
            const style = window.getComputedStyle(media);
            if (style.borderRadius && (style.borderRadius.includes('50%') || parseInt(style.borderRadius) > 40)) return true;
            return false;
        },

        getButtonScale(media) {
            const rect = media.getBoundingClientRect();
            const minSide = Math.min(rect.width, rect.height);
            if (minSide < 180) return 0.85;
            if (minSide < 280) return 0.95;
            return 1;
        },

        // Open video in new tab for best quality viewing
        useDirectDownload: false,

        // LinkedIn doesn't reliably use React Fiber for thumbnails
        useReactThumbnail: false,

        isInternalUrl(url) {
            const lower = (url || '').toLowerCase();
            return lower.includes('//www.linkedin.com') || lower.includes('//linkedin.com');
        },

        // LinkedIn image URL upgrading — force highest resolution
        upgradeImageUrl(url) {
            if (url && url.includes('media.licdn.com/dms/image')) {
                return url.replace(/\/(100|200|400|800)\//g, '/1000/');
            }
            return url;
        },

        // LinkedIn video thumbnail extraction
        extractThumbnail(media, interceptedUrls, safeSendMessage, callback) {
            // Check intercepted URLs for video covers
            if (interceptedUrls.size > 0) {
                const covers = Array.from(interceptedUrls).filter(u => u.includes('videocover'));
                if (covers.length > 0) {
                    callback(covers[0]);
                    return;
                }
            }

            // Ask background script for network-intercepted images
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
                if (lower.includes('.m3u8') || lower.includes('.mpd') || lower.includes('stream_type=dash') || lower.includes('bytestart')) {
                    return false;
                }
                return (lower.includes('licdn.com') && (lower.includes('video') || lower.includes('playback'))) || lower.includes('.mp4');
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
            const lowerKey = key.toLowerCase();
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
            const lowerVal = val.toLowerCase();
            return (lowerVal.includes('licdn.com') && (lowerVal.includes('video') || lowerVal.includes('playlist') || lowerVal.includes('playback'))) || lowerVal.includes('.mp4');
        },

        extractPriorityReactUrl(val, isVideoContext) {
            if (val && typeof val.streamingUrl === 'string') {
                let suffix = '#video.mp4';
                if (val.height) suffix = `#_q=${val.height}p_video.mp4`;
                return val.streamingUrl + suffix;
            }
            if (val && typeof val.progressiveUrl === 'string') {
                let suffix = '#video.mp4';
                if (val.height) suffix = `#_q=${val.height}p_video.mp4`;
                return val.progressiveUrl + suffix;
            }
            return null;
        },

        isValidVideo(url) {
            if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
            if (url.includes('stream_type=dash') || url.includes('.mpd')) return false;
            const lower = url.toLowerCase();
            return !(lower.includes('//www.linkedin.com') || lower.includes('//linkedin.com'));
        },

        extractVideoUrlFromDOM(el) {
            // LinkedIn stores video sources in a data-sources attribute on <video>
            if (el.tagName === 'VIDEO') {
                const sourcesData = el.getAttribute('data-sources');
                if (sourcesData) {
                    try {
                        const sources = JSON.parse(sourcesData);
                        if (Array.isArray(sources)) {
                            let best = null;
                            let bestBitrate = -1;
                            for (const src of sources) {
                                if (src && src.src && typeof src.src === 'string' && this.isValidVideo(src.src)) {
                                    if (!src.src.includes('.mp4') || src.src.includes('manifest')) continue;
                                    if (src.type && (src.type.includes('mpegurl') || src.type.includes('dash'))) continue;

                                    const bitrate = parseInt(src['data-bitrate'] || '0', 10);
                                    if (bitrate > bestBitrate) {
                                        bestBitrate = bitrate;
                                        best = src.src;
                                    }
                                }
                            }
                            if (best) return best + '#_q=progressive_video.mp4';
                        }
                    } catch (e) {}
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
