/*
  index.js — page-specific logic for the ManyScale index page
  Depends on: constructsToArray(), dataToArray() (manyscale.js)
              window.MeasureStats (cache-stats.js)
              Isotope (vendor)
*/

// ── Construct filter ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  const container  = document.getElementById("construct-filter-list");
  const toggleBtn  = document.getElementById("filter-toggle-btn");
  const filterPanel = document.getElementById("filter-panel");
  const filterSearch = document.getElementById("filter-search");
  const filterLabel  = document.getElementById("filter-label");

  // Populate construct list from data source
  constructsToArray().then(function(array) {
    array.sort((a, b) => a.name.localeCompare(b.name));
    container.innerHTML = '<li data-filter="*" class="filter-active">All Constructs</li>';
    array.forEach(c => {
      container.innerHTML += `<li data-filter=".${c.name.toLowerCase().replace(/\s+/g, "-")}">${c.name}</li>`;
    });
  });

  // Toggle panel open/close
  toggleBtn.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = filterPanel.classList.toggle("open");
    toggleBtn.classList.toggle("open", isOpen);
    if (isOpen) filterSearch.focus();
  });

  // Close panel when clicking outside the wrapper
  document.addEventListener("click", e => {
    if (!e.target.closest(".construct-filter-wrapper")) {
      filterPanel.classList.remove("open");
      toggleBtn.classList.remove("open");
    }
  });

  // Live search: hide non-matching constructs (always keep "All Constructs" visible)
  filterSearch.addEventListener("input", () => {
    const q = filterSearch.value.toLowerCase();
    container.querySelectorAll("li").forEach(li => {
      if (li.dataset.filter === "*") return;
      li.style.display = (!q || li.textContent.toLowerCase().includes(q)) ? "" : "none";
    });
  });

});

// ── Records, pagination, filter interactivity ─────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // -- State ------------------------------------------------------------------
  const PAGE_SIZE = 5;
  let allRecords = [];
  let currentPage = 1;
  const selectedFilters = new Set();   // class names without leading "."

  // -- Card accent bar gradients (top → bottom). Add more entries here. ------
  const CARD_GRADIENTS = [
    "linear-gradient(180deg, #c9d6f0, #b8a9d9)",  // periwinkle → soft purple
    "linear-gradient(180deg, #f5c0d0, #f0a0b0)",  // blush → dusty rose
    "linear-gradient(180deg, #aed4f5, #a0c8e8)",  // powder blue → slate blue
    "linear-gradient(180deg, #b5e8c8, #9dd4c0)",  // sage → seafoam
    "linear-gradient(180deg, #f5c8d8, #f5e0a0)",  // petal → buttercup
    "linear-gradient(180deg, #d4c0e8, #f0c8e0)",  // lavender → lilac blush
    "linear-gradient(180deg, #f5c8a8, #f5e0b0)",  // peach → cream
    "linear-gradient(180deg, #b8ecd4, #b8ddf0)",  // mint → sky
    "linear-gradient(180deg, #f0b8b0, #f0b8d0)",  // dusty coral → mauve
    "linear-gradient(180deg, #a8d8b8, #a8c8d8)",  // celadon → mist
    "linear-gradient(180deg, #d8c8f0, #c8d8f0)",  // wisteria → cornflower
    "linear-gradient(180deg, #f5e0b0, #d8f0f0)",  // warm sand → cool mint
  ];

  // -- Filter helpers ---------------------------------------------------------

  function getConstructClasses(rec) {
    return (rec.fields["Construct(s)"] || []).map(c => c.toLowerCase().replace(/\s+/g, "-"));
  }

  function filteredRecords() {
    if (selectedFilters.size === 0) return allRecords;
    return allRecords.filter(rec =>
      [...selectedFilters].every(cls => getConstructClasses(rec).includes(cls))
    );
  }

  // -- Filter UI state --------------------------------------------------------

  function updateFilterLabel() {
    const label = document.getElementById("filter-label");
    if (!label) return;
    if (selectedFilters.size === 0) {
      label.textContent = "All Constructs";
    } else if (selectedFilters.size === 1) {
      const cls = [...selectedFilters][0];
      const li = document.querySelector(`#construct-filter-list li[data-filter=".${cls}"]`);
      label.textContent = li ? li.textContent : cls;
    } else {
      label.textContent = `${selectedFilters.size} constructs`;
    }
  }

  function updateListActiveState() {
    const filterList = document.getElementById("construct-filter-list");
    if (!filterList) return;
    filterList.querySelectorAll("li").forEach(li => {
      if (li.dataset.filter === "*") {
        li.classList.toggle("filter-active", selectedFilters.size === 0);
      } else {
        li.classList.toggle("filter-active", selectedFilters.has(li.dataset.filter.slice(1)));
      }
    });
  }

  function renderFilterTags() {
    const bar = document.getElementById("filter-tags-bar");
    if (!bar) return;
    if (selectedFilters.size === 0) { bar.innerHTML = ""; return; }

    const filterList = document.getElementById("construct-filter-list");
    bar.innerHTML = [...selectedFilters].map(cls => {
      const li = filterList?.querySelector(`li[data-filter=".${cls}"]`);
      const name = li ? li.textContent.replace(/^✓\s*/, "") : cls;
      return `<span class="filter-tag"><span class="filter-tag-label">${name}</span><button class="filter-tag-remove" data-remove="${cls}" aria-label="Remove ${name}">&times;</button></span>`;
    }).join("");

    bar.querySelectorAll(".filter-tag-remove").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        selectedFilters.delete(btn.dataset.remove);
        currentPage = 1;
        renderPage();
        renderFilterTags();
        updateFilterLabel();
        updateListActiveState();
        scrollToPortfolio();
      });
    });
  }

  // -- Scroll helper ----------------------------------------------------------

  function scrollToPortfolio() {
    const el = document.getElementById('portfolio');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // -- Render -----------------------------------------------------------------

  function renderPage() {
    const records = filteredRecords();
    const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRecords = records.slice(start, start + PAGE_SIZE);

    const container = document.getElementById("records_output");

    // Cancel any in-progress animation, then pin the current rendered height so
    // clearing innerHTML doesn't cause an instant snap to zero.
    container.style.transition = 'none';
    const oldHeight = container.offsetHeight; // forces reflow, also cancels prior transition
    if (oldHeight > 0) {
      container.style.overflow = 'hidden';
      container.style.height = oldHeight + 'px';
    }

    container.innerHTML = '';

    pageRecords.forEach(rec => {
      const barGradient = CARD_GRADIENTS[allRecords.indexOf(rec) % CARD_GRADIENTS.length];
      const thisPdfPath = rec.fields?.["Final PDF"]?.[0]?.f_localPath;

      let linkHTML = "";
      if (thisPdfPath) {
        linkHTML = `
          <a href="${thisPdfPath}" class="view-project" target="_blank" aria-label="View full measure">
            <i class="bi bi-file-pdf"></i>Measure (PDF)
          </a>
        `;
      }

      container.innerHTML += `
        <div class="col-lg-12 ${getConstructClasses(rec).join(" ")}">
          <article class="portfolio-card">
            <div class="card-body-flex">
              <div class="construct-accent-bar" style="background: ${barGradient}"></div>
              <div class="construct-details">
                <div class="construct-header">
                  <span class="construct-category">${rec.fields["Construct(s)"]?.join(", ")}</span>
                  <time class="construct-year">${rec.fields.Year}</time>
                </div>
                <a href="details/${rec.fields['MeasureID']}">
                  <h3 class="construct-title">${rec.fields["Measure Name"]}</h3>
                </a>
                <p class="construct-description">${rec.fields["Primary Reference"]}</p>
                <div class="overlay-content">
                  <a href="details/${rec.fields['MeasureID']}">
                    <i class="bi bi-chevron-double-right"></i>Details
                  </a>
                  ${linkHTML}
                </div>
              </div>
            </div>
          </article>
        </div>`;
    });

    // Isotope was used here for masonry layout, but all cards are col-lg-12 (full-width),
    // so it produced identical output to normal block flow. Filtering and pagination are
    // handled entirely by renderPage() — Isotope's arrange() was never called.
    // Removed: isotope.pkgd.min.js, imagesloaded.pkgd.min.js from footer.

    // Animate container to the new natural height.
    if (oldHeight > 0) {
      const newHeight = container.scrollHeight;
      void container.offsetHeight; // force reflow so browser sees oldHeight before animating
      container.style.transition = 'height 0.3s ease';
      container.style.height = newHeight + 'px';
      container.addEventListener('transitionend', () => {
        container.style.height = '';
        container.style.overflow = '';
        container.style.transition = '';
      }, { once: true });
    }

    renderPaginationControls(records.length, totalPages);
  }

  // -- Pagination -------------------------------------------------------------

  function renderPaginationControls(total, totalPages) {
    const pager = document.getElementById("pagination-controls");
    const pagerTop = document.getElementById("pagination-controls-top");
    if (!pager) return;

    if (totalPages <= 1) {
      pager.innerHTML = '';
      if (pagerTop) pagerTop.innerHTML = '';
      return;
    }

    const rangeStart = (currentPage - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(currentPage * PAGE_SIZE, total);

    let html = '<div class="pagination-wrapper">';
    html += `<p class="pagination-info">Showing ${rangeStart}–${rangeEnd} of ${total}</p>`;
    html += '<ul class="pagination-list">';

    const prevStyle = currentPage > 1 ? '' : ' style="opacity:0;pointer-events:none"';
    html += `<li><button class="page-btn" data-page="${currentPage - 1}"${prevStyle}>&lsaquo; Prev</button></li>`;

    const spread = 2;
    const pageStart = Math.max(1, currentPage - spread);
    const pageEnd = Math.min(totalPages, currentPage + spread);

    if (pageStart > 1) {
      html += `<li><button class="page-btn" data-page="1">1</button></li>`;
      if (pageStart > 2) html += `<li><span class="page-ellipsis">&hellip;</span></li>`;
    }

    for (let p = pageStart; p <= pageEnd; p++) {
      html += `<li><button class="page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button></li>`;
    }

    if (pageEnd < totalPages) {
      if (pageEnd < totalPages - 1) html += `<li><span class="page-ellipsis">&hellip;</span></li>`;
      html += `<li><button class="page-btn" data-page="${totalPages}">${totalPages}</button></li>`;
    }

    const nextStyle = currentPage < totalPages ? '' : ' style="opacity:0;pointer-events:none"';
    html += `<li><button class="page-btn" data-page="${currentPage + 1}"${nextStyle}>Next &rsaquo;</button></li>`;

    html += '</ul></div>';
    pager.innerHTML = html;
    if (pagerTop) pagerTop.innerHTML = html;

    [pager, pagerTop].filter(Boolean).forEach(el => {
      el.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.dataset.page);
          if (p >= 1 && p <= totalPages && p !== currentPage) {
            currentPage = p;
            renderPage();
            scrollToPortfolio();
          }
        });
      });
    });
  }

  dataToArray().then(records => {
    allRecords = records;
    renderPage();
  });

  // Intercept filter clicks — multi-select with tag UI
  const filterList = document.getElementById("construct-filter-list");
  filterList.addEventListener("click", e => {
    const li = e.target.closest("li[data-filter]");
    if (!li) return;

    const filter = li.dataset.filter;

    if (filter === "*") {
      selectedFilters.clear();
    } else {
      const cls = filter.slice(1);
      if (selectedFilters.has(cls)) selectedFilters.delete(cls);
      else selectedFilters.add(cls);
    }

    currentPage = 1;
    renderPage();
    renderFilterTags();
    updateFilterLabel();
    updateListActiveState();
    scrollToPortfolio();

    // Clear the search box so all items are visible again
    const filterSearch = document.getElementById("filter-search");
    if (filterSearch) {
      filterSearch.value = "";
      filterList.querySelectorAll("li").forEach(el => el.style.display = "");
    }

    // Close panel only on "All Constructs"; stay open so user can add more filters
    if (filter === "*") {
      const filterPanel  = document.getElementById("filter-panel");
      const filterToggle = document.getElementById("filter-toggle-btn");
      if (filterPanel)  filterPanel.classList.remove("open");
      if (filterToggle) filterToggle.classList.remove("open");
    }
  });

});

// ── Stats counter ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("measurestats-output");
  if (!container || !window.MeasureStats) return;
  container.innerHTML = `
    <div class="stat-item">
      <div class="stat-number purecounter" data-purecounter-start="0" data-purecounter-end="${window.MeasureStats.totalMeasures}" data-purecounter-duration="1"></div>
      <div class="stat-label">Measures</div>
    </div>
    <div class="stat-item">
      <div class="stat-number purecounter" data-purecounter-start="0" data-purecounter-end="${window.MeasureStats.totalConstructs}" data-purecounter-duration="1"></div>
      <div class="stat-label">Constructs</div>
    </div>
    <div class="stat-item">
      <div class="stat-number purecounter" data-purecounter-start="0" data-purecounter-end="${window.MeasureStats.totalItems}" data-purecounter-duration="1"></div>
      <div class="stat-label">Total Items</div>
    </div>
  `;
});
