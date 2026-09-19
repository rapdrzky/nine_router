FROM decolua/9router:0.5.75@sha256:7c893bc2c27ecea2ae337abd5eacfec9e5763091b3a3b7862fc0625b770bb156

COPY patch_oc_nine_router.js /app/patch_oc_nine_router.js

CMD ["node", "/app/patch_oc_nine_router.js", "--start"]
