const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateCompanionFolderRequest(
  input: { name: string; parentRelativePath: string },
  existingFolders: string[],
) {
  const name = input.name;
  if (!name.trim() || name.length > 120 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
      /[. ]$/.test(name) || WINDOWS_RESERVED_NAME.test(name)) {
    return { error: "Enter a valid Windows folder name.", name: null, parentRelativePath: null };
  }
  const parentRelativePath = input.parentRelativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (parentRelativePath && !existingFolders.includes(parentRelativePath)) {
    return { error: "Choose an existing synced parent folder.", name: null, parentRelativePath: null };
  }
  const relativePath = [parentRelativePath, name].filter(Boolean).join("/");
  if (existingFolders.includes(relativePath)) {
    return { error: "That folder already exists.", name: null, parentRelativePath: null };
  }
  return { error: null, name, parentRelativePath };
}
