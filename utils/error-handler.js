// Global error handler
(() => {
    window.addEventListener('error', function(event) {
        // Prevent handling of null/undefined events
        if (!event) return;
        
        // Safely extract error information
        const errorInfo = {
            message: event.error?.message || event.message || 'Unknown error',
            stack: event.error?.stack || null,
            filename: event.filename || null,
            lineno: event.lineno || null,
            colno: event.colno || null
        };
        
        console.error('Script error:', errorInfo);
    });
    
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
        if (!event || !event.reason) return;
        
        console.error('Unhandled promise rejection:', {
            message: event.reason.message || 'Unknown error',
            stack: event.reason.stack || null
        });
    });
})(); 