FROM decolua/9router:0.5.75

COPY patch_oc_nine_router.js /app/patch_oc_nine_router.js
COPY start_patch_oc_nine_router.sh /app/start_patch_oc_nine_router.sh
RUN chmod +x /app/start_patch_oc_nine_router.sh

CMD ["/app/start_patch_oc_nine_router.sh"]
