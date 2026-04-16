/* Gallery Panel — extracted from social-panel.js
 * Owns: gallery grid, filtering, stats, select mode, lightbox
 * Depends on social-panel.js helpers: _socAPI, _socEscapeHtml, _socTimeAgo,
 *   _socMakePlatformBadge, _socIsImageItem, _socSkeletonCards, _socShowToast
 */

// ─── State ───────────────────────────────────────────────────────────────────
let _galCache = null;           // cached gallery items (grouped)
let _galFavOnly = false;        // favorites-only toggle
let _galLightboxItems = [];     // current lightbox items array
let _galLightboxIndex = -1;     // current lightbox item index
let _galSelectMode = false;     // multi-select mode
const _galSelectedIds = new Set();
let _galInitialized = false;
let _galCarouselSlideIndex = 0; // current slide index within a carousel lightbox

// ─── Public API ──────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function galPanelInit(root) {
  if (_galInitialized) return;
  _galInitialized = true;

  // Filter bar
  var galSearch     = root.querySelector('#soc-gallery-search');
  var galTypeFilter = root.querySelector('#soc-gallery-type-filter');
  var galFavToggle  = root.querySelector('#soc-gallery-fav-toggle');
  var galSort       = root.querySelector('#soc-gallery-sort');
  if (galSearch)     galSearch.addEventListener('input', _galApplyFilters);
  if (galTypeFilter) galTypeFilter.addEventListener('change', _galApplyFilters);
  if (galSort)       galSort.addEventListener('change', _galApplyFilters);
  if (galFavToggle)  galFavToggle.addEventListener('click', function () {
    _galFavOnly = !_galFavOnly;
    galFavToggle.classList.toggle('active', _galFavOnly);
    _galApplyFilters();
  });

  // Select mode
  var galSelectToggle = root.querySelector('#soc-gallery-select-toggle');
  if (galSelectToggle) galSelectToggle.addEventListener('click', _galToggleSelectMode);
  var galSelectAll = root.querySelector('#soc-gallery-select-all');
  if (galSelectAll) galSelectAll.addEventListener('click', _galSelectAll);
  var galDeselectAll = root.querySelector('#soc-gallery-deselect-all');
  if (galDeselectAll) galDeselectAll.addEventListener('click', _galDeselectAll);
  var galDeleteSelected = root.querySelector('#soc-gallery-delete-selected');
  if (galDeleteSelected) galDeleteSelected.addEventListener('click', _galDeleteSelected);

  // Lightbox
  var lightbox      = root.querySelector('#soc-lightbox');
  var lightboxClose = root.querySelector('#soc-lightbox-close');
  var lightboxPrev  = root.querySelector('#soc-lightbox-prev');
  var lightboxNext  = root.querySelector('#soc-lightbox-next');
  if (lightboxClose) lightboxClose.addEventListener('click', function () { _galCloseLightbox(); });
  if (lightbox) lightbox.addEventListener('click', function (e) { if (e.target === lightbox) _galCloseLightbox(); });
  if (lightboxPrev) lightboxPrev.addEventListener('click', function () { _galLightboxNavigate(-1); });
  if (lightboxNext) lightboxNext.addEventListener('click', function () { _galLightboxNavigate(1); });
  document.addEventListener('keydown', function (e) {
    if (!lightbox || !lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') _galCloseLightbox();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // If viewing a carousel, arrow keys navigate slides
      var currentEntry = _galLightboxItems[_galLightboxIndex];
      if (currentEntry && currentEntry.type === 'carousel' && currentEntry.slides && currentEntry.slides.length > 1) {
        if (e.key === 'ArrowLeft') galActions.carouselPrev();
        else galActions.carouselNext();
      } else {
        if (e.key === 'ArrowLeft') _galLightboxNavigate(-1);
        else _galLightboxNavigate(1);
      }
    }
  });
}

// eslint-disable-next-line no-unused-vars
function galPanelLoad() {
  var social = _socAPI();
  var root   = document.getElementById('social-view');
  var grid   = root && root.querySelector('#soc-gallery-grid');
  if (!grid) return;

  grid.className = '';
  grid.innerHTML = _socSkeletonCards(8);

  if (!social) { grid.innerHTML = '<div class="soc-empty" style="grid-column:1/-1"><p>Social API unavailable</p></div>'; return; }

  social.getGalleryGrouped()
    .then(function (items) {
      _galCache = items || [];
      _galApplyFilters();
    })
    .catch(function (err) {
      console.error('[Gallery] Failed to load:', err);
      grid.innerHTML = '<div class="soc-empty" style="grid-column:1/-1"><p>Failed to load gallery</p></div>';
    });
}

// eslint-disable-next-line no-unused-vars
function galPanelRefresh() {
  _galCache = null;
  galPanelLoad();
}

/** Reset select mode (called when switching away from gallery tab) */
// eslint-disable-next-line no-unused-vars
function galPanelResetSelect() {
  _galSelectMode = false;
  _galSelectedIds.clear();
  var root = document.getElementById('social-view');
  if (!root) return;
  var toolbar = root.querySelector('#soc-gallery-select-toolbar');
  if (toolbar) toolbar.style.display = 'none';
  var toggleBtn = root.querySelector('#soc-gallery-select-toggle');
  if (toggleBtn) toggleBtn.classList.remove('active');
  root.querySelectorAll('.soc-gallery-item.selected').forEach(function (el) { el.classList.remove('selected'); });
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function _galUpdateStats(root) {
  var statsEl = root && root.querySelector('#soc-gallery-stats');
  if (!statsEl || !_galCache) return;

  var total = _galCache.length;
  var images = 0;
  var favs = 0;
  for (var i = 0; i < _galCache.length; i++) {
    var entry = _galCache[i];
    var item = entry.item || entry;
    if (item.content_type === 'image' || item.media_url || _socIsImageItem(item) || entry.type === 'carousel' || item.content_type === 'video') images++;
    if (item.rating && item.rating > 0) favs++;
  }

  statsEl.innerHTML =
    '<span class="soc-gallery-stat-pill">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16"/></svg>' +
      total + ' Total</span>' +
    '<span class="soc-gallery-stat-pill">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2 6h4m0 0v12m0-12l4 12m4-12h4m0 0v12m0-12l4 12"/></svg>' +
      images + ' Media</span>' +
    '<span class="soc-gallery-stat-pill">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="' + (favs > 0 ? 'var(--warning)' : 'none') + '" stroke="currentColor" stroke-width="1.5" d="m12 3.5l2.713 5.497L20.7 9.91l-3.85 3.75l.909 5.298L12 16.183l-5.758 2.776l.909-5.298L3.3 9.91l5.987-.914z"/></svg>' +
      favs + ' Favorites</span>';
}

// ─── Filtering ───────────────────────────────────────────────────────────────

function _galApplyFilters() {
  var root = document.getElementById('social-view');
  var grid = root && root.querySelector('#soc-gallery-grid');
  if (!grid || !_galCache) return;

  _galUpdateStats(root);

  var searchVal = (root.querySelector('#soc-gallery-search') || {}).value || '';
  var typeVal   = (root.querySelector('#soc-gallery-type-filter') || {}).value || '';
  var sortVal   = (root.querySelector('#soc-gallery-sort') || {}).value || 'newest';
  var searchLow = searchVal.toLowerCase();

  var filtered = _galCache.filter(function (entry) {
    var item = entry.item || entry;
    if (searchLow && !(item.prompt_used || '').toLowerCase().includes(searchLow) &&
        !(item.output || '').toLowerCase().includes(searchLow)) return false;
    if (typeVal && item.content_type !== typeVal && entry.type !== typeVal) return false;
    if (_galFavOnly && !(item.rating && item.rating > 0)) return false;
    return true;
  });

  if (sortVal === 'oldest') {
    filtered.sort(function (a, b) { return ((a.item || a).created_at || '').localeCompare((b.item || b).created_at || ''); });
  } else if (sortVal === 'top_rated') {
    filtered.sort(function (a, b) { return ((b.item || b).rating || 0) - ((a.item || a).rating || 0); });
  } else {
    filtered.sort(function (a, b) { return ((b.item || b).created_at || '').localeCompare((a.item || a).created_at || ''); });
  }

  if (filtered.length === 0) {
    grid.className = '';
    grid.innerHTML =
      '<div class="soc-empty" style="grid-column:1/-1">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m14.5 9.5l-5 5m0-5l5 5"/></svg>' +
      '<p>' + (_galCache.length === 0 ? 'No generated content yet' : 'No items match filters') + '</p>' +
      (_galCache.length === 0 ? '<p class="hint">Use the Create tab to generate copy, images, and more</p>' : '') +
      '</div>';
    return;
  }

  grid.className = 'soc-gallery-grid';
  grid.innerHTML = filtered.map(function (entry) {
    var item = entry.item || entry;
    var isFav = item.rating && item.rating > 0;
    var isCarousel = entry.type === 'carousel';
    var isVideo = item.content_type === 'video';
    var imageUrl = item.media_url || (_socIsImageItem(item) ? item.output : null);
    var isImage = !!imageUrl && !isVideo;
    var isSelected = _galSelectedIds.has(item.id);
    var clickAction = _galSelectMode
      ? 'galActions.toggleSelectItem(\'' + item.id + '\')'
      : 'galActions.openLightbox(\'' + item.id + '\')';

    // Carousel badge overlay
    var carouselBadge = isCarousel
      ? '<div class="gal-carousel-badge">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"><path fill="currentColor" d="M2 6h4v12H2zm16 0h4v12h-4zM7 4h10v16H7z"/></svg>' +
          ' 1/' + entry.slides.length +
        '</div>'
      : '';

    // Video duration from metadata
    var videoDuration = '';
    if (isVideo) {
      try {
        var meta = item.metadata ? JSON.parse(item.metadata) : {};
        if (meta.duration) {
          var secs = Math.round(meta.duration);
          var mins = Math.floor(secs / 60);
          videoDuration = mins + ':' + String(secs % 60).padStart(2, '0');
        }
      } catch (_e) { /* ignore */ }
    }

    // Select checkbox
    var checkbox = _galSelectMode
      ? '<div class="soc-gallery-checkbox' + (isSelected ? ' checked' : '') + '" onclick="galActions.toggleSelectItem(\'' + item.id + '\')">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="' + (isSelected ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2" d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/>' +
          (isSelected ? '<path fill="none" stroke="var(--bg-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M7 13l3 3l7-7"/>' : '') +
          '</svg></div>'
      : '';

    // Media area
    var mediaHtml;
    if (isVideo && item.media_url) {
      mediaHtml =
        '<div class="gal-video-thumb" onclick="' + clickAction + '">' +
          '<video class="soc-gallery-item-media" src="' + _socEscapeHtml(item.media_url) + '" preload="metadata" muted></video>' +
          '<div class="gal-video-play-overlay">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.14v14l11-7z"/></svg>' +
          '</div>' +
          (videoDuration ? '<div class="gal-video-duration">' + videoDuration + '</div>' : '') +
        '</div>';
    } else if (isImage) {
      mediaHtml = '<img class="soc-gallery-item-media" src="' + _socEscapeHtml(imageUrl) + '" onclick="' + clickAction + '" />' + carouselBadge;
    } else {
      mediaHtml = '<div class="soc-gallery-item-content" onclick="' + clickAction + '">' + _socEscapeHtml(item.output) + '</div>';
    }

    // Action buttons
    var hasMedia = isImage || isVideo;
    var actions =
      (isImage ? '<button class="soc-icon-btn" onclick="galActions.copyImageUrl(\'' + _socEscapeHtml(imageUrl) + '\')" title="Copy URL">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
        '</button>' : '') +
      (hasMedia && !isCarousel ? '<button class="soc-icon-btn" onclick="galActions.downloadImage(\'' + item.id + '\')" title="Download">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16"/></svg>' +
        '</button>' : '') +
      (isCarousel ? '<button class="soc-icon-btn" onclick="galActions.downloadCarousel(\'' + entry.group_id + '\')" title="Download All">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16"/></svg>' +
        '</button>' : '') +
      '<button class="soc-icon-btn soc-favorite-btn' + (isFav ? ' active' : '') + '" data-id="' + item.id + '" onclick="galActions.toggleFavorite(\'' + item.id + '\',' + (isFav ? '0' : '5') + ')" title="Favorite">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5" d="m12 3.5l2.713 5.497L20.7 9.91l-3.85 3.75l.909 5.298L12 16.183l-5.758 2.776l.909-5.298L3.3 9.91l5.987-.914z"/></svg>' +
      '</button>' +
      '<button class="soc-icon-btn danger" onclick="galActions.deleteGenerated(\'' + item.id + '\')" title="Delete">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>' +
      '</button>';

    // Default platform: carousel→instagram, video→tiktok, else first available
    var draftDefault = isCarousel ? 'instagram' : (isVideo ? 'tiktok' : '');
    var draftDataId = isCarousel ? entry.group_id : item.id;
    var draftDataType = isCarousel ? 'carousel' : (isVideo ? 'video' : 'single');

    var draftBtn =
      '<div class="gal-draft-wrapper">' +
        '<button class="gal-draft-btn" onclick="event.stopPropagation(); galActions.showDraftPicker(this)" ' +
          'data-item-id="' + draftDataId + '" data-draft-type="' + draftDataType + '" data-default-platform="' + draftDefault + '">' +
          'Draft' +
        '</button>' +
      '</div>';

    return (
      '<div class="soc-gallery-item' + (isImage || isVideo ? ' soc-gallery-image-item' : '') + (isCarousel ? ' gal-carousel-item' : '') + (isVideo ? ' gal-video-item' : '') + (isSelected ? ' selected' : '') + '" data-id="' + item.id + '">' +
        checkbox + mediaHtml +
        '<div class="soc-gallery-item-footer">' +
          '<span>' + _socMakePlatformBadge(item.platform || item.content_type) + ' · ' + _socTimeAgo(item.created_at) + '</span>' +
          '<div class="soc-gallery-item-actions">' + actions + draftBtn + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  if (_galSelectMode) _galUpdateSelectCount();
}

// ─── Select Mode ─────────────────────────────────────────────────────────────

function _galToggleSelectMode() {
  _galSelectMode = !_galSelectMode;
  _galSelectedIds.clear();
  var root = document.getElementById('social-view');
  if (!root) return;
  var toggle = root.querySelector('#soc-gallery-select-toggle');
  if (toggle) toggle.classList.toggle('active', _galSelectMode);
  var toolbar = root.querySelector('#soc-gallery-select-toolbar');
  if (toolbar) toolbar.classList.toggle('active', _galSelectMode);
  _galApplyFilters();
}

function _galSelectAll() {
  var root = document.getElementById('social-view');
  if (!root) return;
  root.querySelectorAll('.soc-gallery-item[data-id]').forEach(function (el) {
    var id = el.dataset.id;
    if (id) { _galSelectedIds.add(id); el.classList.add('selected'); }
  });
  _galUpdateSelectCount();
}

function _galDeselectAll() {
  _galSelectedIds.clear();
  var root = document.getElementById('social-view');
  if (!root) return;
  root.querySelectorAll('.soc-gallery-item.selected').forEach(function (el) { el.classList.remove('selected'); });
  _galUpdateSelectCount();
}

function _galUpdateSelectCount() {
  var root = document.getElementById('social-view');
  var countEl = root && root.querySelector('#soc-gallery-select-count');
  if (countEl) countEl.textContent = _galSelectedIds.size + ' selected';
  var deleteBtn = root && root.querySelector('#soc-gallery-delete-selected');
  if (deleteBtn) deleteBtn.disabled = _galSelectedIds.size === 0;
}

function _galDeleteSelected() {
  var social = _socAPI();
  if (!social || _galSelectedIds.size === 0) return;
  if (!confirm('Delete ' + _galSelectedIds.size + ' selected items?')) return;
  var ids = Array.from(_galSelectedIds);
  social.bulkDeleteGenerated(ids)
    .then(function (result) {
      if (result.success) {
        _socShowToast('Deleted ' + (result.deleted || ids.length) + ' items', 'success');
        _galSelectedIds.clear();
        galPanelLoad();
      } else {
        _socShowToast('Failed to delete: ' + (result.error || 'Unknown error'), 'error');
      }
    })
    .catch(function () { _socShowToast('Failed to delete selected items', 'error'); });
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function _galCloseLightbox() {
  var root = document.getElementById('social-view');
  var lightbox = root && root.querySelector('#soc-lightbox');
  if (lightbox) lightbox.classList.remove('active');
  _galLightboxItems = [];
  _galLightboxIndex = -1;
}

function _galLightboxShowItem(entry) {
  var root   = document.getElementById('social-view');
  var lbBody = root && root.querySelector('#soc-lightbox-body');
  var lbMeta = root && root.querySelector('#soc-lightbox-meta');
  if (!lbBody) return;

  var item = entry.item || entry;
  var isCarousel = entry.type === 'carousel' && entry.slides && entry.slides.length > 1;
  var isVideo = item.content_type === 'video';

  if (isCarousel) {
    _galCarouselSlideIndex = 0;
    _galRenderCarouselLightbox(entry, lbBody, lbMeta);
  } else if (isVideo && item.media_url) {
    lbBody.innerHTML =
      '<video class="gal-lightbox-video" controls preload="metadata" src="' + _socEscapeHtml(item.media_url) + '"></video>';

    if (lbMeta) {
      lbMeta.innerHTML =
        '<span>' + _socMakePlatformBadge(item.platform || item.content_type) + '</span>' +
        (item.prompt_used ? '<span style="opacity:0.7;font-style:italic">' + _socEscapeHtml(item.prompt_used) + '</span>' : '') +
        '<span>' + _socTimeAgo(item.created_at) + '</span>' +
        '<button class="soc-icon-btn" onclick="galActions.downloadImage(\'' + item.id + '\')" title="Download" style="margin-left:auto">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16"/></svg>' +
        '</button>' +
        _galLightboxDraftBtn(item.id, 'video', 'tiktok');
    }
  } else {
    var imageUrl = item.media_url || (_socIsImageItem(item) ? item.output : null);
    if (imageUrl) {
      lbBody.innerHTML = '<img src="' + _socEscapeHtml(imageUrl) + '" style="max-width:100%;border-radius:8px;" />';
    } else {
      lbBody.textContent = item.output || '';
    }

    if (lbMeta) {
      var copyUrlBtn = imageUrl
        ? '<button class="soc-icon-btn" onclick="galActions.copyImageUrl(\'' + _socEscapeHtml(imageUrl) + '\')" title="Copy URL" style="margin-left:auto">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
          '</button>'
        : '';
      var downloadBtn = imageUrl
        ? '<button class="soc-icon-btn" onclick="galActions.downloadImage(\'' + item.id + '\')" title="Download">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16"/></svg>' +
          '</button>'
        : '';
      lbMeta.innerHTML =
        '<span>' + _socMakePlatformBadge(item.platform || item.content_type) + '</span>' +
        (item.prompt_used ? '<span style="opacity:0.7;font-style:italic">' + _socEscapeHtml(item.prompt_used) + '</span>' : '') +
        '<span>' + _socTimeAgo(item.created_at) + '</span>' +
        copyUrlBtn + downloadBtn +
        _galLightboxDraftBtn(item.id, 'single', '');
    }
  }
}

function _galRenderCarouselLightbox(entry, lbBody, lbMeta) {
  var slides = entry.slides;
  var idx = _galCarouselSlideIndex;
  var slide = slides[idx];
  var imageUrl = slide.media_url || slide.output;

  // Slide image
  var html = '<div class="gal-carousel-lightbox">' +
    '<div class="gal-carousel-slide-area">' +
      '<button class="gal-carousel-arrow gal-carousel-arrow-left" onclick="galActions.carouselPrev()">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m15 18l-6-6l6-6"/></svg>' +
      '</button>' +
      '<img src="' + _socEscapeHtml(imageUrl) + '" class="gal-carousel-slide-img" />' +
      '<button class="gal-carousel-arrow gal-carousel-arrow-right" onclick="galActions.carouselNext()">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m9 18l6-6l-6-6"/></svg>' +
      '</button>' +
    '</div>';

  // Dots
  html += '<div class="gal-carousel-dots">';
  for (var i = 0; i < slides.length; i++) {
    html += '<span class="gal-carousel-dot' + (i === idx ? ' active' : '') + '" onclick="galActions.carouselGoTo(' + i + ')"></span>';
  }
  html += '</div>';

  // Counter
  html += '<div class="gal-carousel-counter">' + (idx + 1) + ' / ' + slides.length + '</div>';
  html += '</div>';

  lbBody.innerHTML = html;

  if (lbMeta) {
    var item = entry.item;
    lbMeta.innerHTML =
      '<span>' + _socMakePlatformBadge(item.platform || item.content_type) + '</span>' +
      (item.prompt_used ? '<span style="opacity:0.7;font-style:italic">' + _socEscapeHtml(item.prompt_used) + '</span>' : '') +
      '<span>' + _socTimeAgo(item.created_at) + '</span>' +
      '<button class="soc-icon-btn" onclick="galActions.downloadCarousel(\'' + entry.group_id + '\')" title="Download All" style="margin-left:auto">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v13m0 0l-4-4m4 4l4-4M4 21h16"/></svg>' +
      '</button>' +
      _galLightboxDraftBtn(entry.group_id, 'carousel', 'instagram');
  }
}

function _galLightboxNavigate(dir) {
  if (_galLightboxItems.length === 0) return;
  _galLightboxIndex = (_galLightboxIndex + dir + _galLightboxItems.length) % _galLightboxItems.length;
  _galLightboxShowItem(_galLightboxItems[_galLightboxIndex]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _galPlatformLabel(platform) {
  var labels = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X' };
  return labels[platform] || platform;
}

function _galLightboxDraftBtn(itemId, draftType, defaultPlatform) {
  return '<div class="gal-draft-wrapper" style="margin-left:4px">' +
    '<button class="gal-draft-btn" onclick="event.stopPropagation(); galActions.showDraftPicker(this)" ' +
      'data-item-id="' + itemId + '" data-draft-type="' + draftType + '" data-default-platform="' + (defaultPlatform || '') + '">' +
      'Draft' +
    '</button>' +
  '</div>';
}

// ─── Global Actions ──────────────────────────────────────────────────────────

window.galActions = {
  copyImageUrl: function (url) {
    if (!url) return;
    navigator.clipboard.writeText(url)
      .then(function () { _socShowToast('Image URL copied!', 'success'); })
      .catch(function () { _socShowToast('Copy failed', 'error'); });
  },

  downloadImage: function (id) {
    var social = _socAPI();
    if (!social) return;
    social.downloadImage(id)
      .then(function (result) {
        if (result.success) {
          _socShowToast('Image saved', 'success');
        } else if (result.error !== 'Cancelled') {
          _socShowToast(result.error || 'Download failed', 'error');
        }
      })
      .catch(function () { _socShowToast('Download failed', 'error'); });
  },

  deleteGenerated: function (id) {
    var social = _socAPI();
    if (!social || !confirm('Delete this item?')) return;
    social.deleteGenerated(id)
      .then(function (result) {
        if (result.success) {
          if (_galCache) {
            _galCache = _galCache.filter(function (e) { return (e.item || e).id !== id; });
          }
          var el = document.querySelector('#social-view .soc-gallery-item[data-id="' + id + '"]');
          if (el) el.remove();
          _socShowToast('Deleted', 'success');
        } else {
          _socShowToast('Failed to delete', 'error');
        }
      })
      .catch(function () { _socShowToast('Failed to delete', 'error'); });
  },

  toggleSelectItem: function (id) {
    var root = document.getElementById('social-view');
    var el = root && root.querySelector('.soc-gallery-item[data-id="' + id + '"]');
    if (_galSelectedIds.has(id)) {
      _galSelectedIds.delete(id);
      if (el) el.classList.remove('selected');
    } else {
      _galSelectedIds.add(id);
      if (el) el.classList.add('selected');
    }
    _galUpdateSelectCount();
  },

  toggleFavorite: function (id, rating) {
    var social = _socAPI();
    if (!social) return;
    var btn = document.querySelector('.soc-favorite-btn[data-id="' + id + '"]');
    if (btn) {
      var willBeActive = rating > 0;
      btn.classList.toggle('active', willBeActive);
      var path = btn.querySelector('path');
      if (path) path.setAttribute('fill', willBeActive ? 'currentColor' : 'none');
      btn.classList.remove('soc-fav-pop');
      void btn.offsetWidth;
      btn.classList.add('soc-fav-pop');
    }
    social.favoriteGenerated(id, rating)
      .then(function (result) {
        if (result.success) {
          _socShowToast(rating > 0 ? 'Favorited' : 'Unfavorited', 'success');
          galPanelLoad();
        } else if (btn) {
          btn.classList.toggle('active', !rating);
          var p = btn.querySelector('path');
          if (p) p.setAttribute('fill', rating ? 'none' : 'currentColor');
        }
      })
      .catch(function () {
        if (btn) {
          btn.classList.toggle('active', !rating);
          var p = btn.querySelector('path');
          if (p) p.setAttribute('fill', rating ? 'none' : 'currentColor');
        }
        _socShowToast('Failed to update', 'error');
      });
  },

  openLightbox: function (id) {
    var root     = document.getElementById('social-view');
    var lightbox = root && root.querySelector('#soc-lightbox');
    if (!lightbox || !_galCache) return;

    var idx = _galCache.findIndex(function (e) { return (e.item || e).id === id; });
    if (idx === -1) return;

    _galLightboxItems = _galCache;
    _galLightboxIndex = idx;
    _galCarouselSlideIndex = 0;
    _galLightboxShowItem(_galCache[idx]);
    lightbox.classList.add('active');
  },

  downloadCarousel: function (groupId) {
    var social = _socAPI();
    if (!social) return;
    social.downloadCarousel(groupId)
      .then(function (result) {
        if (result.success) {
          _socShowToast('Carousel saved (' + result.slides + ' slides)', 'success');
        } else if (result.error !== 'Cancelled') {
          _socShowToast(result.error || 'Download failed', 'error');
        }
      })
      .catch(function () { _socShowToast('Download failed', 'error'); });
  },

  carouselPrev: function () {
    var entry = _galLightboxItems[_galLightboxIndex];
    if (!entry || entry.type !== 'carousel') return;
    _galCarouselSlideIndex = (_galCarouselSlideIndex - 1 + entry.slides.length) % entry.slides.length;
    var root = document.getElementById('social-view');
    var lbBody = root && root.querySelector('#soc-lightbox-body');
    var lbMeta = root && root.querySelector('#soc-lightbox-meta');
    if (lbBody) _galRenderCarouselLightbox(entry, lbBody, lbMeta);
  },

  carouselNext: function () {
    var entry = _galLightboxItems[_galLightboxIndex];
    if (!entry || entry.type !== 'carousel') return;
    _galCarouselSlideIndex = (_galCarouselSlideIndex + 1) % entry.slides.length;
    var root = document.getElementById('social-view');
    var lbBody = root && root.querySelector('#soc-lightbox-body');
    var lbMeta = root && root.querySelector('#soc-lightbox-meta');
    if (lbBody) _galRenderCarouselLightbox(entry, lbBody, lbMeta);
  },

  carouselGoTo: function (idx) {
    var entry = _galLightboxItems[_galLightboxIndex];
    if (!entry || entry.type !== 'carousel') return;
    _galCarouselSlideIndex = idx;
    var root = document.getElementById('social-view');
    var lbBody = root && root.querySelector('#soc-lightbox-body');
    var lbMeta = root && root.querySelector('#soc-lightbox-meta');
    if (lbBody) _galRenderCarouselLightbox(entry, lbBody, lbMeta);
  },

  showDraftPicker: function (btn) {
    // Close any existing picker
    document.querySelectorAll('.gal-draft-dropdown.active').forEach(function (d) { d.classList.remove('active'); });

    var wrapper = btn.closest('.gal-draft-wrapper');
    if (!wrapper) return;

    var existing = wrapper.querySelector('.gal-draft-dropdown');
    if (existing) {
      existing.classList.toggle('active');
      return;
    }

    var defaultPlatform = btn.dataset.defaultPlatform || '';
    var itemId = btn.dataset.itemId;
    var draftType = btn.dataset.draftType;
    var platforms = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x'];

    var dropdown = document.createElement('div');
    dropdown.className = 'gal-draft-dropdown active';
    dropdown.innerHTML = platforms.map(function (p) {
      return '<button class="gal-draft-platform-btn' + (p === defaultPlatform ? ' suggested' : '') + '" ' +
        'onclick="event.stopPropagation(); galActions.createDraft(\'' + itemId + '\', \'' + p + '\', \'' + draftType + '\')">' +
        _galPlatformLabel(p) +
        '</button>';
    }).join('');
    wrapper.appendChild(dropdown);

    // Close on outside click
    setTimeout(function () {
      document.addEventListener('click', function closePicker(e) {
        if (!wrapper.contains(e.target)) {
          dropdown.classList.remove('active');
          document.removeEventListener('click', closePicker);
        }
      });
    }, 0);
  },

  createDraft: function (itemId, platform, draftType) {
    var social = _socAPI();
    if (!social || !_galCache) return;

    // Find the entry
    var entry = null;
    for (var i = 0; i < _galCache.length; i++) {
      var e = _galCache[i];
      var eItem = e.item || e;
      if (eItem.id === itemId || (e.group_id && e.group_id === itemId)) {
        entry = e;
        break;
      }
    }
    if (!entry) { _socShowToast('Item not found', 'error'); return; }

    var item = entry.item || entry;
    var mediaItems = [];
    var videoPath = null;
    var content = item.output || item.prompt_used || '';

    if (draftType === 'carousel' && entry.slides) {
      entry.slides.forEach(function (slide) {
        if (slide.media_url) {
          mediaItems.push({ filePath: slide.media_url, type: 'image', fileName: slide.media_url.split(/[/\\]/).pop() });
        }
      });
    } else if (draftType === 'video' && item.media_url) {
      videoPath = item.media_url;
    } else if (item.media_url) {
      mediaItems.push({ filePath: item.media_url, type: 'image', fileName: item.media_url.split(/[/\\]/).pop() });
    }

    var postData = {
      platform: platform,
      content: content,
      status: 'draft',
      generated_content_id: item.id,
      media_items: mediaItems.length > 0 ? JSON.stringify(mediaItems) : null,
      video_path: videoPath,
    };

    social.createPost(postData)
      .then(function (result) {
        if (result.success) {
          _socShowToast('Draft created for ' + _galPlatformLabel(platform), 'success');
          // Close dropdown
          document.querySelectorAll('.gal-draft-dropdown.active').forEach(function (d) { d.classList.remove('active'); });
        } else {
          _socShowToast(result.error || 'Failed to create draft', 'error');
        }
      })
      .catch(function () { _socShowToast('Failed to create draft', 'error'); });
  },
};
