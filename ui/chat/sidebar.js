/* Sidebar toggle logic */
(function () {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');

  if (!sidebar || !toggleBtn) return;

  // Restore saved state
  const saved = localStorage.getItem('sidebar-collapsed');
  if (saved === 'true') {
    sidebar.classList.add('collapsed');
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  });
})();
