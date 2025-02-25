// OS detector - handles OS detection and UI setup
(function() {
    // Function to run when DOM is loaded
    function setupOS() {
        // Detect OS and show appropriate instructions
        const userAgent = navigator.userAgent;
        let osClass = '';
        
        if (userAgent.indexOf('Mac') !== -1) {
            osClass = 'os-mac';
            const macOnlyElement = document.querySelector('.mac-only');
            if (macOnlyElement) {
                macOnlyElement.classList.add('active');
            }
        } else if (userAgent.indexOf('Windows') !== -1) {
            osClass = 'os-windows';
            const windowsOnlyElement = document.querySelector('.windows-only');
            if (windowsOnlyElement) {
                windowsOnlyElement.classList.add('active');
            }
        } else if (userAgent.indexOf('Linux') !== -1) {
            osClass = 'os-linux';
            const linuxOnlyElement = document.querySelector('.linux-only');
            if (linuxOnlyElement) {
                linuxOnlyElement.classList.add('active');
            }
        }
        
        if (document.body) {
            document.body.classList.add(osClass);
        }
        
        // Show all options button
        const showAllButton = document.getElementById('showAllOptions');
        if (showAllButton) {
            showAllButton.style.display = 'inline-block';
            showAllButton.addEventListener('click', () => {
                document.querySelectorAll('.install-option').forEach(option => {
                    option.style.display = 'block';
                });
                showAllButton.style.display = 'none';
            });
        }
    }

    // Run setup when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupOS);
    } else {
        // DOM already loaded, run immediately
        setupOS();
    }
})(); 