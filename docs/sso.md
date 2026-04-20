# SSO Setup (Audiobookshelf + Authentik)

Bookstory SSO uses Audiobookshelf OpenID endpoints and your identity provider (for example Authentik).

Flow overview:
1. Bookstory calls Audiobookshelf `/auth/openid`.
2. Audiobookshelf redirects to your OpenID provider.
3. After login, Audiobookshelf returns an access token.
4. Bookstory stores the token in the system keyring.

## Required Audiobookshelf OpenID settings

Enable OpenID in Audiobookshelf and make sure `authOpenIDMobileRedirectURIs` includes:

- `http://127.0.0.1:45873/oidc-callback`

Bookstory uses fixed localhost callback port `45873`.

## Authentik provider settings

In Authentik, allow redirect URI:

- `https://<your-audiobookshelf-host>/auth/openid/callback`

If Audiobookshelf is hosted under a subfolder, use that full callback path.

## Nginx Proxy Manager notes

The localhost callback `http://127.0.0.1:45873/oidc-callback` is local to Bookstory and is not handled by Nginx Proxy Manager.

Nginx Proxy Manager should handle your public Audiobookshelf URL:
1. Create Proxy Host for `https://<your-audiobookshelf-host>`.
2. Forward to internal ABS host and port.
3. Enable SSL and Force SSL.
4. Ensure `Host` and `X-Forwarded-Proto` are passed correctly.

If `X-Forwarded-Proto` is wrong or missing, OpenID callback validation can fail.

## End-user checklist

1. OpenID is enabled in Audiobookshelf.
2. `authOpenIDMobileRedirectURIs` includes `http://127.0.0.1:45873/oidc-callback`.
3. Authentik redirect URIs include `https://<your-audiobookshelf-host>/auth/openid/callback`.
4. Reverse proxy serves Audiobookshelf over HTTPS with correct forwarded headers.
