self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '営業予定表';
  const body = data.body || 'リマインドがあります';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'reminder',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
