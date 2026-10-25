FROM decolua/9router:0.5.109@sha256:28474ba417ac76198abce43b6758b187201e0acac364f72ff3918b0f7e11b040

COPY patch_opencode_nine_router.js /app/

CMD ["node", "/app/patch_opencode_nine_router.js", "--start"]
