// Global error handler
window.addEventListener('error', function(event) {
    console.error('Script error:', {
        message: event.error?.message,
        stack: event.error?.stack,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
    });
}); 