// Minimal typings for the File System Access API (Chrome / Edge only).
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker?(options?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}
