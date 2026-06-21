document.addEventListener("DOMContentLoaded", () => { 
const form = document.querySelector("#contact-form"); 
      const loadingEl = form.querySelector(".loading");
      const errorEl = form.querySelector(".error-message");
      const sentEl = form.querySelector(".sent-message");
      const submitBtn = form.querySelector("button[type='submit']");


form.addEventListener("submit", async (e) => { 
e.preventDefault(); 
console.log("trying to send mail");

      // Reset previous states
      loadingEl.classList.add("d-block");
      errorEl.classList.remove("d-block");
      sentEl.classList.remove("show");

      const formData = Object.fromEntries(new FormData(form).entries());

      try {
        const response = await fetch(form.getAttribute("action") || "/contact", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(formData)
        });

      const result = await response.json();

      loadingEl.classList.remove("d-block");

      if (result.success) {
        // fade out submit button
        submitBtn.style.transition = "opacity 0.5s";
        submitBtn.style.opacity = 0;
        submitBtn.disabled = true;

        // fade in success message
        sentEl.style.display = "block";
        sentEl.classList.add("show");
        form.reset();
      } else {
        errorEl.textContent = result.error || "Failed to send message.";
        errorEl.classList.add("d-block");
      }
    } catch (err) {
      loadingEl.classList.remove("d-block");
      errorEl.textContent = err.message || "An error occurred.";
      errorEl.classList.add("d-block");
    }
  });
});