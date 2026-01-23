// src/api/api.js
import axios from "axios";

export const apiPublic = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export const apiPrivate = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

export function setAuthToken(access) {
  if (access) apiPrivate.defaults.headers.Authorization = `Bearer ${access}`;
  else delete apiPrivate.defaults.headers.Authorization;
}
