// Theme loader - handles theme detection and application
(function() {
    // Function to safely add/remove classes
    function safelyAddClass(element, className) {
        if (element && element.classList) {
            element.classList.add(className);
        }
    }
    
    function safelyRemoveClass(element, className) {
        if (element && element.classList) {
            element.classList.remove(className);
        }
    }

    // Check URL parameters first
    const urlParams = new URLSearchParams(window.location.search);
    const themeParam = urlParams.get('theme');
    
    // Apply theme based on URL parameter
    if (themeParam === 'dark') {
        safelyAddClass(document.documentElement, 'dark-theme');
        // We'll handle body after it's loaded
    } else if (themeParam === 'light') {
        safelyRemoveClass(document.documentElement, 'dark-theme');
        // We'll handle body after it's loaded
    } else {
        // Try to detect from parent
        try {
            const parentBody = window.parent.document.body;
            if (parentBody && parentBody.classList && parentBody.classList.contains('dark-theme')) {
                safelyAddClass(document.documentElement, 'dark-theme');
            }
        } catch (e) {
            // Fallback to system preference
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                safelyAddClass(document.documentElement, 'dark-theme');
            }
        }
    }

    // Function to apply theme when DOM is ready
    function applyTheme() {
        // Now we can safely access document.body
        if (document.documentElement.classList.contains('dark-theme')) {
            safelyAddClass(document.body, 'dark-theme');
        } else {
            safelyRemoveClass(document.body, 'dark-theme');
        }
    }

    // Apply theme when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyTheme);
    } else {
        // DOM already loaded, apply immediately
        applyTheme();
    }
    
    // Listen for theme changes in parent window
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'THEME_CHANGED') {
            try {
                const parentBody = window.parent.document.body;
                if (parentBody && parentBody.classList && parentBody.classList.contains('dark-theme')) {
                    safelyAddClass(document.documentElement, 'dark-theme');
                    safelyAddClass(document.body, 'dark-theme');
                } else {
                    safelyRemoveClass(document.documentElement, 'dark-theme');
                    safelyRemoveClass(document.body, 'dark-theme');
                }
            } catch (error) {
                console.error('Error applying theme:', error);
            }
        }
    });
})(); 