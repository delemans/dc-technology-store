function generarCheckoutAutomatico(producto, variante, emailCliente, telefonoCliente) {
    const payload = {
        amount_in_cents: variante.precio * 100,
        currency: "COP",
        customer_email: emailCliente,
        payment_method_types: ["NEQUI", "CARD", "PSE"],
        reference: "DC-" + Date.now(),
        redirect_url: "https://dctecnology.xyz/confirmacion.html"
    };

    fetch('https://api.wompi.co/v1/transactions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer PRV_PUBLIC_KEY_DC_TECHNOLOGY',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        // Redirige al cliente al portal de pago de Nequi/PSE/Tarjeta
        window.location.href = data.data.payment_link;
    });
}