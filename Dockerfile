FROM decolua/9router:0.5.86@sha256:c6ee24aba24db5e2c70675c6d8ee5846392793b032a4554943b6a8c47a0bedb8

COPY patch_oc_nine_router.js /app/patch_oc_nine_router.js

CMD ["node", "/app/patch_oc_nine_router.js", "--start"]
