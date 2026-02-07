let accessToken = null;
let refreshToken = null;

export const tokenStorage = {
  getAccess() {
    return accessToken;
  },
  getRefresh() {
    return refreshToken;
  },
  set(access, refresh) {
    if (access) accessToken = access;
    if (refresh) refreshToken = refresh;
  },
  clear() {
    accessToken = null;
    refreshToken = null;
  },
};
