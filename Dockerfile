FROM decolua/9router:0.5.85@sha256:7a0d0c4b2fe71c27621b82751c102136ed5c90d6d53c42fedb69f5310e6d9b5e

COPY patch_oc_nine_router.js /app/patch_oc_nine_router.js

CMD ["node", "/app/patch_oc_nine_router.js", "--start"]
